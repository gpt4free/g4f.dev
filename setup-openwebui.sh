#!/bin/bash
#
# OpenWeb UI - G4F Integration Setup Script
# 
# This script automates the setup of g4f (GPT4Free) integration with Open WebUI
# It configures the MCP server and sets up provider endpoints
#
# Usage:
#   ./setup-openwebui.sh [options]
#
# Options:
#   --http           Use HTTP transport for MCP (default: stdio)
#   --port PORT      MCP server port (default: 8765)
#   --host HOST      MCP server host (default: 0.0.0.0)
#   --docker         Setup for Docker-based Open WebUI
#   --patches        Install integration patches for OpenWeb UI
#   --openwebui PATH Path to Open WebUI installation directory
#   --help           Show this help message
#

set -e

# Default configuration
MCP_TRANSPORT="stdio"
MCP_PORT="8765"
MCP_HOST="0.0.0.0"
DOCKER_MODE=false
INSTALL_PATCHES=false
OPENWEBUI_PATH=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print colored message
print_msg() {
    echo -e "${2}${1}${NC}"
}

# Print error and exit
error_exit() {
    print_msg "ERROR: $1" "$RED" >&2
    exit 1
}

# Print success message
success() {
    print_msg "✓ $1" "$GREEN"
}

# Print info message
info() {
    print_msg "ℹ $1" "$YELLOW"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --http)
            MCP_TRANSPORT="http"
            shift
            ;;
        --port)
            MCP_PORT="$2"
            shift 2
            ;;
        --host)
            MCP_HOST="$2"
            shift 2
            ;;
        --docker)
            DOCKER_MODE=true
            shift
            ;;
        --patches)
            INSTALL_PATCHES=true
            shift
            ;;
        --openwebui)
            OPENWEBUI_PATH="$2"
            shift 2
            ;;
        --help)
            head -n 20 "$0" | tail -n 17
            exit 0
            ;;
        *)
            error_exit "Unknown option: $1. Use --help for usage."
            ;;
    esac
done

echo "================================================"
echo "  OpenWeb UI - G4F Integration Setup"
echo "================================================"
echo ""

# Check if Python is installed
info "Checking prerequisites..."
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    error_exit "Python 3 is required but not installed. Please install Python 3.8 or higher."
fi
success "Python is installed"

# Get Python command
PYTHON_CMD=$(command -v python3 || command -v python)

# Check if g4f is installed
if ! $PYTHON_CMD -c "import g4f" 2>/dev/null; then
    info "g4f is not installed. Installing now..."
    if ! $PYTHON_CMD -m pip install g4f; then
        error_exit "Failed to install g4f. Please install manually: $PYTHON_CMD -m pip install g4f"
    fi
    success "g4f installed successfully"
else
    success "g4f is already installed"
fi

# Determine Open WebUI config directory
if [ "$DOCKER_MODE" = true ]; then
    OPENWEBUI_CONFIG_DIR="./open-webui-data"
    info "Using Docker mode. Config will be saved to: $OPENWEBUI_CONFIG_DIR"
    mkdir -p "$OPENWEBUI_CONFIG_DIR"
else
    OPENWEBUI_CONFIG_DIR="${OPENWEBUI_CONFIG_DIR:-$HOME/.config/openwebui}"
    info "Config directory: $OPENWEBUI_CONFIG_DIR"
    mkdir -p "$OPENWEBUI_CONFIG_DIR"
fi

# Create MCP configuration
info "Creating MCP server configuration..."
MCP_CONFIG_FILE="$OPENWEBUI_CONFIG_DIR/mcp-config.json"

if [ "$MCP_TRANSPORT" = "http" ]; then
    cat > "$MCP_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "g4f": {
      "url": "http://$MCP_HOST:$MCP_PORT/mcp",
      "transport": "http",
      "description": "GPT4Free MCP server - web search, scraping, image generation",
      "enabled": true
    }
  }
}
EOF
else
    cat > "$MCP_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "g4f": {
      "command": "$PYTHON_CMD",
      "args": ["-m", "g4f.mcp"],
      "description": "GPT4Free MCP server - web search, scraping, image generation",
      "enabled": true
    }
  }
}
EOF
fi
success "MCP configuration created: $MCP_CONFIG_FILE"

# Copy the full configuration file if it exists
if [ -f "openwebui-config.json" ]; then
    cp openwebui-config.json "$OPENWEBUI_CONFIG_DIR/g4f-config.json"
    success "Full configuration copied to: $OPENWEBUI_CONFIG_DIR/g4f-config.json"
fi

# Start MCP server if using HTTP mode
if [ "$MCP_TRANSPORT" = "http" ]; then
    info "Starting MCP server in HTTP mode..."
    
    # Verify g4f.mcp module exists
    if ! $PYTHON_CMD -c "import g4f.mcp" 2>/dev/null; then
        error_exit "g4f.mcp module not found. Please ensure g4f is properly installed."
    fi
    
    # Check if server is already running on the port
    PORT_IN_USE=false
    if command -v lsof >/dev/null 2>&1; then
        # Use lsof if available
        if lsof -Pi :$MCP_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            PORT_IN_USE=true
        fi
    elif command -v netstat >/dev/null 2>&1; then
        # Fallback to netstat
        if netstat -tuln 2>/dev/null | grep -q ":$MCP_PORT "; then
            PORT_IN_USE=true
        fi
    elif command -v ss >/dev/null 2>&1; then
        # Fallback to ss
        if ss -tuln 2>/dev/null | grep -q ":$MCP_PORT "; then
            PORT_IN_USE=true
        fi
    fi
    
    if [ "$PORT_IN_USE" = true ]; then
        info "MCP server already running on port $MCP_PORT"
    else
        # Start MCP server in background
        nohup $PYTHON_CMD -m g4f.mcp --http --port $MCP_PORT --host $MCP_HOST > mcp-server.log 2>&1 &
        MCP_PID=$!
        echo $MCP_PID > mcp-server.pid
        
        # Wait for server to start
        sleep 3
        
        # Check if process is still running
        if ! kill -0 $MCP_PID 2>/dev/null; then
            error_exit "MCP server process died immediately after start. Check mcp-server.log for details."
        fi
        
        # Additional check: look for common error patterns in logs
        if [ -f mcp-server.log ]; then
            # Check for Python errors - only fail on serious indicators
            if grep -qi "traceback\|exception:" mcp-server.log; then
                error_exit "MCP server encountered errors during startup. Check mcp-server.log for details."
            fi
        fi
        
        success "MCP server started (PID: $MCP_PID)"
        info "Server logs: mcp-server.log"
        info "To stop: kill \$(cat mcp-server.pid)"
    fi
fi

# Install patches if requested
if [ "$INSTALL_PATCHES" = true ]; then
    echo ""
    info "Installing OpenWeb UI integration patches..."
    
    # Determine OpenWeb UI path
    if [ -z "$OPENWEBUI_PATH" ]; then
        # Try to find OpenWeb UI installation
        POSSIBLE_PATHS=(
            "/opt/open-webui"
            "/usr/local/lib/open-webui"
            "$HOME/.local/share/open-webui"
            "/app"  # Docker path
        )
        
        for path in "${POSSIBLE_PATHS[@]}"; do
            if [ -d "$path" ]; then
                OPENWEBUI_PATH="$path"
                break
            fi
        done
        
        if [ -z "$OPENWEBUI_PATH" ]; then
            info "OpenWeb UI path not auto-detected. Patches will be copied to current directory."
            info "Use --openwebui /path/to/open-webui to specify path."
            OPENWEBUI_PATH="./openwebui-patches"
            mkdir -p "$OPENWEBUI_PATH"
        fi
    fi
    
    # Check if patches exist
    if [ ! -f "openwebui_provider_hook.py" ]; then
        error_exit "Patch files not found. Run this script from the g4f.dev directory."
    fi
    
    # Create patches directory
    PATCHES_DIR="$OPENWEBUI_PATH/g4f-patches"
    mkdir -p "$PATCHES_DIR"
    
    # Copy patch files
    cp openwebui_provider_hook.py "$PATCHES_DIR/" 2>/dev/null || info "Provider hook already exists"
    cp openwebui_context_patch.py "$PATCHES_DIR/" 2>/dev/null || info "Context patch already exists"
    cp openwebui_selector_component.js "$PATCHES_DIR/" 2>/dev/null || info "UI component already exists"
    cp openwebui-config.json "$PATCHES_DIR/" 2>/dev/null || info "Config already exists"
    
    success "Patches copied to: $PATCHES_DIR"
    
    # Create integration instructions
    cat > "$PATCHES_DIR/INSTALL.txt" << 'EOF'
OpenWeb UI Integration Patches for g4f

To integrate these patches:

1. Backend Integration (Python):
   - Copy openwebui_provider_hook.py to backend/apps/webui/
   - Copy openwebui_context_patch.py to backend/apps/webui/
   - Add imports to your main application file
   - Create API endpoints (see OPENWEBUI_PATCHES.md)

2. Frontend Integration (JavaScript):
   - Copy openwebui_selector_component.js to src/lib/components/g4f/
   - Import and use in your chat settings component
   - Add <div id="g4f-provider-selector"></div> to your UI

3. Configuration:
   - Copy openwebui-config.json to static/ or backend/data/
   - Ensure it's accessible via HTTP

See OPENWEBUI_PATCHES.md for detailed installation instructions.
EOF
    
    success "Installation guide created: $PATCHES_DIR/INSTALL.txt"
    
    echo ""
    info "Patch Installation Summary:"
    echo "  Location: $PATCHES_DIR"
    echo "  Files:"
    echo "    - openwebui_provider_hook.py (Provider & Model Hook)"
    echo "    - openwebui_context_patch.py (Context Management)"
    echo "    - openwebui_selector_component.js (UI Component)"
    echo "    - openwebui-config.json (Configuration)"
    echo "    - INSTALL.txt (Installation Guide)"
    echo ""
    info "See OPENWEBUI_PATCHES.md for integration instructions"
fi

echo ""
echo "================================================"
echo "  Setup Complete!"
echo "================================================"
echo ""

# Print next steps
info "Next Steps:"
echo ""
echo "1. Configuration created at: $MCP_CONFIG_FILE"

if [ "$MCP_TRANSPORT" = "http" ]; then
    echo "2. MCP server is running at: http://$MCP_HOST:$MCP_PORT/mcp"
    echo "3. Test the server:"
    echo "   curl -X POST http://$MCP_HOST:$MCP_PORT/mcp \\"
    echo "     -H \"Content-Type: application/json\" \\"
    echo "     -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'"
else
    echo "2. MCP server will start automatically with Open WebUI (stdio mode)"
    echo "3. Server command: $PYTHON_CMD -m g4f.mcp"
fi

echo ""
echo "4. Configure Open WebUI models:"
if [ "$DOCKER_MODE" = true ]; then
    echo "   docker run -d -p 3000:8080 \\"
    echo "     -e OPENAI_API_BASE_URL=https://g4f.space/api \\"
    echo "     -e OPENAI_API_KEY=not-required \\"
    echo "     -v $OPENWEBUI_CONFIG_DIR:/app/backend/data \\"
    echo "     --name open-webui \\"
    echo "     ghcr.io/open-webui/open-webui:main"
else
    echo "   - Add model in Open WebUI settings:"
    echo "     Name: G4F Auto"
    echo "     Base URL: https://g4f.space/api"
    echo "     API Key: not-required"
fi

echo ""
echo "5. Documentation:"
echo "   - Integration Guide: https://g4f.dev/docs/openwebui-integration.html"
echo "   - MCP Usage: https://g4f.dev/docs/mcp-usage-guide.html"
echo "   - API Docs: https://g4f.dev/docs/backend_api_documentation.html"
echo ""

info "For help: https://github.com/gpt4free/g4f.dev/issues"
echo ""
