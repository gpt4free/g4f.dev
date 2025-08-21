# G4F.dev Documentation and Demo Website

G4F.dev is a documentation and demonstration website for GPT4Free (g4f). It provides comprehensive documentation, API guides, and browser-based demo applications for the GPT4Free JavaScript client library. 

The site uses md2html from the gpt4free repository to convert markdown documentation to HTML pages.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Setup Dependencies

Clone the gpt4free repository to get access to md2html:
```bash
git clone git@github.com:xtekky/gpt4free.git
```
**Note**: Required to access the md2html conversion tool.

Install Node.js dependencies (minimal):
```bash
npm install
```
**Note**: Takes ~1 second. No actual build dependencies.

### Build Documentation Pages

Convert markdown files to HTML using md2html from gpt4free:
```bash
python -m etc.tool.md2html filename.md
```
**Time**: Instant per file. Converts individual markdown files to HTML.

Alternative: Use the local conversion script in docs/:
```bash
cd docs && python3 __main__.py
```
**Time**: ~1-2 seconds. Converts all markdown files in docs/ to HTML using GitHub API.

### Generate Sitemap

Update the sitemap.xml file:
```bash
python3 sitemap.py
```
**Time**: Instant. Generates sitemap.xml for SEO.

## Validation

Always run these validation steps after making changes:

### Documentation Build Validation
```bash
cd docs && python3 __main__.py
```
Verify all markdown files convert to HTML without errors.

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
   - Run `cd docs && python3 __main__.py` to regenerate HTML files
   - Open the corresponding `.html` file in a browser to visually verify changes

2. **JavaScript Client Changes**: After modifying `dist/js/client.js`:
   - Run the JavaScript validation command above
   - Test integration by opening any HTML file in `apps/` directory that uses the client

3. **Template Changes**: After modifying `docs/template.html`:
   - Run `cd docs && python3 __main__.py` to regenerate all HTML files
   - Check that all documentation pages render correctly

## Common Tasks

### Repository Structure Overview

```
.
├── docs/                    # Markdown and HTML documentation files
│   ├── README.md           # Main documentation index (markdown)
│   ├── index.html          # Generated HTML from README.md
│   ├── __main__.py         # Markdown to HTML conversion script
│   ├── template.html       # HTML template for generated pages
│   ├── client.md           # Python client documentation  
│   ├── client.html         # Generated HTML from client.md
│   ├── client_js.md        # JavaScript client documentation
│   ├── client_js.html      # Generated HTML from client_js.md
│   └── ...                 # Additional documentation files (.md and .html pairs)
├── apps/                   # Demo HTML applications
│   ├── index.html          # Apps directory listing
│   ├── calculator.html     # Calculator demo
│   ├── create.py           # Script to generate new apps
│   └── ...                 # Other demo apps
├── dist/                   # Built JavaScript and CSS assets
│   ├── js/client.js        # Main G4F JavaScript client
│   ├── js/client.d.ts      # TypeScript definitions
│   ├── css/               # Stylesheets
│   └── ...                # Other assets
├── api-docs/              # OpenAPI documentation
├── package.json           # NPM package configuration
├── sitemap.py             # Sitemap generation script
└── .github/workflows/     # GitHub Actions workflows
```

### Key Files and Their Purpose

- **`dist/js/client.js`**: The main G4F JavaScript client library for browser usage
- **`docs/README.md`**: Primary documentation entry point with quick examples
- **`docs/__main__.py`**: Converts all markdown files to HTML using GitHub API
- **`docs/template.html`**: HTML template used for generated documentation pages
- **`sitemap.py`**: Python script that generates SEO sitemap.xml
- **`.github/workflows/update-openapi.yml`**: Automated workflow to update API documentation

### Adding New Documentation

1. Create or modify `.md` files in the `docs/` directory
2. Follow the existing documentation structure and tone
3. Run `cd docs && python3 __main__.py` to generate HTML files
4. Test by opening the generated `.html` file in a browser

### Working with Demo Applications

The `apps/` directory contains HTML demo applications that use the G4F JavaScript client:
- Each app is self-contained in a single HTML file
- Apps demonstrate various use cases of the G4F client library
- Test apps by opening them in a web browser after making changes
- Use `apps/create.py` to generate new demo applications

### Working with Documentation Conversion

The documentation system uses a Python script to convert markdown to HTML:
- **`docs/__main__.py`**: Converts all `.md` files to `.html` using GitHub's markdown API
- Requires `GITHUB_TOKEN` environment variable for API access
- Uses `docs/template.html` as the HTML template for all generated pages
- Automatically handles link rewriting (`.md` links become `.html` links)

### GitHub Workflow Integration

The repository includes an automated workflow (`.github/workflows/update-openapi.yml`) that:
- Runs daily to update OpenAPI documentation from the main g4f repository
- Requires no manual intervention
- Updates files in `api-docs/` directory

## Development Environment Notes

### Dependencies Required
- **Python 3**: For documentation conversion and utility scripts
- **Node.js**: For minimal JavaScript validation and NPM
- **gpt4free repository**: For md2html tool access (optional, can use local conversion)

### Build Artifacts
The following directories contain generated files and should be managed carefully:
- `docs/*.html` (generated from `.md` files)  
- `__pycache__/` (Python cache files - excluded by .gitignore)

### No Complex Backend
This is a static documentation site with browser-based JavaScript demos. There is no server-side application or database to configure or manage.

## Troubleshooting

### Documentation Conversion Issues
- Ensure Python 3 is available: `python3 --version`
- Check for GITHUB_TOKEN environment variable: `echo $GITHUB_TOKEN`
- Verify docs/__main__.py syntax: `python3 -m py_compile docs/__main__.py`
- Test template exists: `ls -la docs/template.html`

### JavaScript Client Issues
- Validate syntax with Node.js before committing changes
- Test in multiple browsers when making client library modifications
- Check browser console for JavaScript errors in demo applications

### Python Script Issues
- Ensure Python 3 is available: `python3 --version`  
- Run syntax check: `python3 -m py_compile sitemap.py`
- Verify script permissions: `ls -la *.py`

---

This repository provides documentation and demos for GPT4Free using md2html conversion from the gpt4free repository. Focus on maintaining clear, accurate documentation and functional demo applications that showcase the capabilities of the G4F JavaScript client library.