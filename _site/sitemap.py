import os
from urllib.parse import quote
from xml.etree.ElementTree import Element, SubElement, ElementTree

def generate_sitemap(directory, base_url):
    urlset = Element('urlset', xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    for root, dirs, files in os.walk(directory):
        if "private" in root or "dist" in root or "unfinished" in root:
            continue
        for filename in files:
            if filename.endswith('.html'):
                # Relative path from the root directory
                rel_dir = os.path.relpath(root, directory)
                rel_path = os.path.join(rel_dir, filename) if rel_dir != '.' else filename

                # URL path
                url_path = rel_path
                if url_path.endswith('index.html'):
                    url_path = url_path[:-10]

                url_path_encoded = quote(url_path.replace(os.sep, '/'))
                loc_url = f"{base_url.rstrip('/')}/{url_path_encoded}"

                # Create URL element
                url_element = SubElement(urlset, 'url')
                loc = SubElement(url_element, 'loc')
                loc.text = loc_url

    # Write sitemap.xml
    tree = ElementTree(urlset)
    with open(os.path.join(directory, 'sitemap.xml'), 'wb') as f:
        tree.write(f, encoding='utf-8', xml_declaration=True)

if __name__ == "__main__":
    # Replace with your directory path
    directory_path = os.path.dirname(__file__)  # Current directory
    # Replace with your website's base URL
    base_website_url = 'https://g4f.dev'

    generate_sitemap(directory_path, base_website_url)
