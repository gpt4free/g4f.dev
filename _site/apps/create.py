import asyncio
import re
import argparse
from datetime import datetime
from pathlib import Path

from g4f.cookies import read_cookie_files
from g4f.client import AsyncClient
from g4f.Provider import Azure

import g4f.debug
g4f.debug.logging = True

# Initialize cookies and client
read_cookie_files()
client = AsyncClient(provider=Azure)

# Configuration
DEFAULT_MODEL = ""  # Update with your preferred model
OUTPUT_DIR = Path(".")
REQUEST_DELAY = 5  # Seconds between requests to avoid rate limiting
MAX_RETRIES = 0

# Clean filename helper
def clean_filename(name: str) -> str:
    """Remove special characters and format filename"""
    name = re.sub(r'[^a-zA-Z0-9_\- ]', '', name)
    return name.strip().lower().replace(' ', '_')[:50]

# Enhanced app ideas list
NEW_APPS = [
    "Dynamic Kanban Board (drag & drop)",
    "Mini Spotify / Audio Player",
    "Instagram-like Photo Feed (mock data)",
    "Real-time Chat (WebSockets placeholder)",
    "Expense Tracker (localStorage)",
    "Pac-Man Game (canvas)",
    "Simon Memory Game",
    "Maze Generator & Solver",
    "Typing Speed Test",
    "File-drop Image Compressor",
    "URL Shortener (frontend only)",
    "Tetris",
    "QR-Code Generator & Reader",
    "Paint clone",
    "Snake Game",
    "Flappy Bird clone",
    "Unsplash Photo Search",
    "Markdown Blog Engine (one HTML)",
    "API Tester (like PostMan-lite)",
    "2048 Game"
]

async def create_app(app_name: str, attempt: int = 1):
    """Generate app code with retry logic"""
    try:
        response = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{
                "role": "user", 
                "content": f"""Create a modern, responsive {app_name} as a single HTML file with:
- Mobile-first CSS design
- Interactive JavaScript features
- Clean, commented code
- No external dependencies
Include a brief documentation header."""
            }]
        )
        
        if not response.choices:
            raise ValueError("Empty response from API")
            
        #content = response.choices[0].message.content
        filename = OUTPUT_DIR / f"{clean_filename(app_name)}.html"

        response.choices[0].message.save(filename, allowed_types=["html"])
            
        return True
    
    except Exception as e:
        if attempt <= MAX_RETRIES:
            print(f"Retrying {app_name} (attempt {attempt})...")
            await asyncio.sleep(2 ** attempt)  # Exponential backoff
            return await create_app(app_name, attempt + 1)
        print(f"Failed to create {app_name}: {str(e)}")
        return False

async def main(apps_to_generate):
    """Main execution flow"""
    OUTPUT_DIR.mkdir(exist_ok=True)
    total = len(apps_to_generate)
    
    print(f"🚀 Starting generation of {total} apps...\n")
    
    for i, app in enumerate(apps_to_generate, 1):
        print(f"📝 [{i}/{total}] Generating {app}...")
        start_time = datetime.now()
        
        success = await create_app(app)
        
        duration = (datetime.now() - start_time).total_seconds()
        status = "✅ Success" if success else "❌ Failed"
        print(f"{status} | ⏱️ {duration:.1f}s\n")
        
        await asyncio.sleep(REQUEST_DELAY)
    
    print("✨ Generation process completed!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate web app prototypes")
    parser.add_argument("-a", "--apps", nargs="+", help="Custom list of apps to generate")
    args = parser.parse_args()
    
    selected_apps = args.apps or NEW_APPS
    asyncio.run(main(selected_apps))