import html.parser, pathlib, sys

problems = []
class P(html.parser.HTMLParser):
    pass

for path in sorted(pathlib.Path("design").rglob("*.html")) if pathlib.Path("design").is_dir() else []:
    text = path.read_text(encoding="utf-8")
    try:
        P().feed(text)
    except Exception as exc:  # html.parser is lenient; anything raised is a real break
        problems.append(f"{path}: cannot be parsed ({exc})")
    head = text[:2000].lower()
    if 'dir="rtl"' not in head or 'lang="ar"' not in head:
        problems.append(f"{path}: the <html> tag must carry lang=\"ar\" dir=\"rtl\"")

for adr in sorted(pathlib.Path("docs/adr").glob("*.md")):
    first = adr.read_text(encoding="utf-8").splitlines()[:3]
    if not any(line.startswith("status:") for line in first):
        problems.append(f"{adr}: an ADR starts with a status line")

for p in problems:
    print(p)
print(f"ci.sh check: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
