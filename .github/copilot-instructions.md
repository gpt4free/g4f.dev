# G4F.dev Documentation and Demo Website

G4F.dev is a Jekyll-based documentation and demonstration website for GPT4Free (g4f). It provides comprehensive documentation, API guides, and browser-based demo applications for the GPT4Free JavaScript client library.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Setup Dependencies

Install required Ruby gems (Jekyll and plugins):
```bash
gem install jekyll bundler jekyll-paginate jekyll-sitemap --user-install
export PATH="/home/runner/.local/share/gem/ruby/3.2.0/bin:$PATH"
```
**Note**: Takes ~30 seconds. Ruby gems install to user directory, requiring PATH adjustment.

Install Node.js dependencies (minimal):
```bash
npm install
```
**Note**: Takes ~1 second. No actual build dependencies.

### Build the Documentation Site

Build the Jekyll static site:
```bash
export PATH="/home/runner/.local/share/gem/ruby/3.2.0/bin:$PATH"
jekyll build --safe
```
**Time**: ~0.1-0.2 seconds. Builds to `_site/` directory.

### Run Local Development Server

Start Jekyll development server:
```bash
export PATH="/home/runner/.local/share/gem/ruby/3.2.0/bin:$PATH"
jekyll serve --safe --host 0.0.0.0
```
**Serves on**: http://localhost:4000
**Note**: Use Ctrl+C to stop the server.

### Generate Sitemap

Update the sitemap.xml file:
```bash
python3 sitemap.py
```
**Time**: Instant. Generates sitemap.xml for SEO.

## Validation

Always run these validation steps after making changes:

### Build Validation
```bash
export PATH="/home/runner/.local/share/gem/ruby/3.2.0/bin:$PATH"
jekyll build --safe
```
Verify build completes without errors in ~0.1-0.2 seconds.

### JavaScript Client Validation
```bash
node -e "const fs = require('fs'); const content = fs.readFileSync('dist/js/client.js', 'utf8'); console.log('Client.js file is valid JavaScript')"
```
Ensures the browser client library has valid JavaScript syntax.

### Python Script Validation
```bash
find . -name "*.py" -exec python3 -m py_compile {} \;
```
Validates all Python files compile without syntax errors.

### Manual Testing Scenarios

1. **Documentation Changes**: After modifying any `.md` files in `docs/`:
   - Run `jekyll build --safe` to ensure Markdown renders correctly
   - Start `jekyll serve` and browse to http://localhost:4000/docs/ to visually verify changes

2. **JavaScript Client Changes**: After modifying `dist/js/client.js`:
   - Run the JavaScript validation command above
   - Test integration by opening any HTML file in `apps/` directory that uses the client

3. **Configuration Changes**: After modifying `_config.yml`:
   - Rebuild the site completely: `jekyll build --safe`
   - Check that site navigation and structure remain intact

## Common Tasks

### Repository Structure Overview

```
.
├── docs/                    # Markdown documentation files
│   ├── README.md           # Main documentation index
│   ├── client.md           # Python client documentation  
│   ├── client_js.md        # JavaScript client documentation
│   ├── git.md              # Installation guide
│   └── ...                 # Additional documentation files
├── apps/                   # Demo HTML applications
│   ├── index.html          # Apps directory listing
│   ├── calculator.html     # Calculator demo
│   ├── chat/               # Chat applications
│   └── ...                 # Other demo apps
├── dist/                   # Built JavaScript and CSS assets
│   ├── js/client.js        # Main G4F JavaScript client
│   ├── js/client.d.ts      # TypeScript definitions
│   ├── css/               # Stylesheets
│   └── ...                # Other assets
├── api-docs/              # OpenAPI documentation
├── _config.yml            # Jekyll configuration
├── package.json           # NPM package configuration
├── sitemap.py             # Sitemap generation script
└── .github/workflows/     # GitHub Actions workflows
```

### Key Files and Their Purpose

- **`dist/js/client.js`**: The main G4F JavaScript client library for browser usage
- **`docs/README.md`**: Primary documentation entry point with quick examples
- **`_config.yml`**: Jekyll site configuration with theme and plugin settings
- **`sitemap.py`**: Python script that generates SEO sitemap.xml
- **`.github/workflows/update-openapi.yml`**: Automated workflow to update API documentation

### Adding New Documentation

1. Create or modify `.md` files in the `docs/` directory
2. Follow the existing documentation structure and tone
3. Run `jekyll build --safe` to validate Markdown rendering
4. Test locally with `jekyll serve` before committing

### Working with Demo Applications

The `apps/` directory contains HTML demo applications that use the G4F JavaScript client:
- Each app is self-contained in a single HTML file
- Apps demonstrate various use cases of the G4F client library
- Test apps by opening them in a web browser after making changes

### GitHub Workflow Integration

The repository includes an automated workflow (`.github/workflows/update-openapi.yml`) that:
- Runs daily to update OpenAPI documentation from the main g4f repository
- Requires no manual intervention
- Updates files in `api-docs/` directory

## Development Environment Notes

### Dependencies Required
- **Ruby** (with Jekyll): For building documentation site
- **Node.js**: For minimal JavaScript validation and NPM
- **Python 3**: For sitemap generation and utility scripts

### Build Artifacts
The following directories are generated during build and should not be committed:
- `_site/` (Jekyll build output)  
- `__pycache__/` (Python cache files)
- `.sass-cache/` (Jekyll Sass cache)

### No Complex Backend
This is a static documentation site with browser-based JavaScript demos. There is no server-side application or database to configure or manage.

## Troubleshooting

### Jekyll Build Issues
- Ensure Ruby gems are installed: `gem list | grep jekyll`
- Check PATH includes gem bin directory: `echo $PATH`
- Verify Jekyll can find configuration: `jekyll doctor`

### JavaScript Client Issues
- Validate syntax with Node.js before committing changes
- Test in multiple browsers when making client library modifications
- Check browser console for JavaScript errors in demo applications

### Python Script Issues
- Ensure Python 3 is available: `python3 --version`  
- Run syntax check: `python3 -m py_compile sitemap.py`
- Verify script permissions: `ls -la *.py`

---

This repository provides documentation and demos for GPT4Free. Focus on maintaining clear, accurate documentation and functional demo applications that showcase the capabilities of the G4F JavaScript client library.