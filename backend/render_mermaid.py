import base64
import zlib
import re
import urllib.request
import os

def encode_kroki(text):
    compressed = zlib.compress(text.encode('utf-8'), 9)
    return base64.urlsafe_b64encode(compressed).decode('ascii')

md_path = r"C:\Users\shahi\.gemini\antigravity-ide\brain\e235a8d4-9d0d-4ba2-98c1-e012367d743c\ppt_content.md"
with open(md_path, "r", encoding="utf-8") as f:
    content = f.read()

blocks = re.findall(r'```mermaid\n(.*?)\n```', content, re.DOTALL)
new_content = content

for i, block in enumerate(blocks):
    print(f"Processing diagram {i+1}...")
    encoded = encode_kroki(block)
    url = f"https://kroki.io/mermaid/png/{encoded}"
    img_filename = f"diagram_{i}.png"
    img_path = f"d:/sih project/docs/{img_filename}"
    urllib.request.urlretrieve(url, img_path)
    # Replace the block with the image reference
    md_img = f"![Diagram {i+1}]({img_filename})"
    new_content = new_content.replace(f"```mermaid\n{block}\n```", md_img)

out_md = r"d:\sih project\docs\ppt_content_with_images.md"
with open(out_md, "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Images generated and markdown saved to {out_md}")
