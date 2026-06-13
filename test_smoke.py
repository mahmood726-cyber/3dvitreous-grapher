"""Smoke tests for 3dvitreous-grapher HTML app."""
import re
import codecs


HTML_FILE = "3dvit.html"


def read_html():
    with open(HTML_FILE, encoding="utf-8") as f:
        return f.read()


def test_no_bom():
    with open(HTML_FILE, "rb") as f:
        raw = f.read(3)
    assert raw[:3] != codecs.BOM_UTF8, "File must not have a UTF-8 BOM"


def test_div_balance():
    content = read_html()
    open_divs = len(re.findall(r"<div[\s>]", content))
    close_divs = content.count("</div>")
    assert open_divs == close_divs, f"Div mismatch: {open_divs} open vs {close_divs} close"


def test_no_literal_close_script_in_template_literals():
    content = read_html()
    script_blocks = re.findall(r"<script[^>]*>(.*?)</script>", content, re.DOTALL)
    for block in script_blocks:
        assert "</script>" not in block, "Literal </script> found inside a <script> block"


def test_no_hardcoded_local_paths():
    content = read_html()
    assert "C:/Users/" not in content, "Hardcoded Windows path in HTML"
    assert "C:\\\\Users\\\\" not in content, "Hardcoded Windows path in HTML"
    assert "/home/" not in content, "Hardcoded Unix home path in HTML"


def test_no_unfilled_placeholders():
    content = read_html()
    placeholders = re.findall(r"\{\{[^}]+\}\}|REPLACE_ME|__PLACEHOLDER__", content)
    assert not placeholders, f"Unfilled placeholders found: {placeholders}"


def test_add_credit_no_hardcoded_path():
    with open("add_credit.js", encoding="utf-8") as f:
        content = f.read()
    assert "C:/Users/" not in content, "add_credit.js still has hardcoded local path"
    assert "__dirname" in content or "resolve" in content, "add_credit.js should use relative path resolution"


def test_opacity_fix():
    content = read_html()
    # The old bug: opacity would be set to 1 when user typed 0
    # Verify isFinite guard is used for opacity
    assert "isFinite" in content, "isFinite guard should be present for opacity fix"
    # The old buggy pattern should not appear for opacity
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if "opacity" in line and "parseFloat" in line and "|| 1" in line:
            raise AssertionError(f"Line {i+1}: opacity still uses || 1 pattern: {line.strip()}")
