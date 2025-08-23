import os
import requests

for root, _, files in os.walk(os.path.dirname(__file__)):
    for file in files:
        if file.endswith(".md"):
            filename = "index.html" if file == "README.md" else file.replace(".md", ".html")
            print("File:", filename)
            with open(os.path.join(root, file), 'r') as f:
                try:
                    content = f.read()
                    title = content.splitlines()[0].strip("# ")
                    print("Title:", title)
                except Exception as e:
                    print(f"Error reading file {file}: {e}")
                    continue
            
            try:
                html = requests.post(
                    "https://api.github.com/markdown",
                    json={"text": content.replace(
                        "(README.md)", "(/docs/)").replace(
                        "(../README.md)", "(/docs/)").replace(
                        ".md)", ".html)")},
                    headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"}
                ).text
            except Exception as e:
                print(f"Error converting markdown for {file}: {e}")
                continue
                
            with open(os.path.join(os.path.dirname(__file__), "template.html"), 'r', encoding='utf-8') as f:
                template = f.read()
            
            with open(os.path.join(root, filename), 'w', encoding='utf-8') as f:
                f.write(template.replace("{{ article }}", html)
                              .replace("{{ title }}", title)
                              .replace("{{ filename }}", filename))