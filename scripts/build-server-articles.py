#!/usr/bin/env python3
"""Render server-managed DSH Field Notes from bounded local source files."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import posixpath
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

SOURCE_FILES = ("articles.json", "articles.css", "index.template.html", "article.template.html")
MIGRATION_PLAN_ID = "dsh-articles-to-server-20261029"
ARTICLE_NAV_MARKER = "<!-- DSH_SERVER_ARTICLES_NAV -->"
BT = chr(96)


def fail(message):
    raise SystemExit(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_json(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            .replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def source_snapshot(root):
    if root.is_symlink() or not root.is_dir():
        fail("server article source directory is missing or unsafe")
    expected = set(SOURCE_FILES) | {"migration-manifest.json"}
    if {entry.name for entry in root.iterdir()} != expected:
        fail("server article source file set does not match the migration contract")
    data = {}
    for name in SOURCE_FILES:
        path = root / name
        if path.is_symlink() or not path.is_file():
            fail("server article source contains an unsafe or missing file: " + name)
        raw = path.read_bytes()
        limit = 2 * 1024 * 1024 if name == "articles.json" else 256 * 1024
        if len(raw) > limit:
            fail("server article source exceeds its size bound: " + name)
        data[name] = raw
    migration_path = root / "migration-manifest.json"
    if migration_path.is_symlink() or not migration_path.is_file():
        fail("server article migration manifest is missing or unsafe")
    migration = json.loads(migration_path.read_text(encoding="utf-8"))
    if migration.get("schemaVersion") != 1 or migration.get("planId") != MIGRATION_PLAN_ID:
        fail("server article migration manifest does not match the approved plan")
    initial = migration.get("files")
    if not isinstance(initial, dict) or set(initial) != set(SOURCE_FILES):
        fail("server article migration manifest has an invalid source file map")
    for name in SOURCE_FILES:
        if not re.fullmatch(r"[a-f0-9]{64}", str(initial[name])):
            fail("server article migration manifest has an invalid hash: " + name)
        if name != "articles.json" and sha256(data[name]) != initial[name]:
            fail("server article template asset changed outside its migration plan: " + name)
    hashes = {name: sha256(raw) for name, raw in data.items()}
    digest = hashlib.sha256()
    for name in SOURCE_FILES:
        digest.update(name.encode("utf-8")); digest.update(b"\0"); digest.update(data[name]); digest.update(b"\0")
    return data, hashes, digest.hexdigest()


def validate_collection(raw):
    try:
        collection = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("server article JSON is invalid: " + str(error))
    articles = collection.get("articles") if isinstance(collection, dict) else None
    if collection.get("schemaVersion") != 1 or not isinstance(articles, list) or not 1 <= len(articles) <= 100:
        fail("server article collection schema or count is invalid")
    if not isinstance(collection.get("collectionTitle"), str) or not isinstance(collection.get("collectionDescription"), str):
        fail("server article collection metadata is missing")
    seen = set()
    for item in articles:
        if not isinstance(item, dict):
            fail("server article entry must be an object")
        slug, title, summary = item.get("slug"), item.get("title"), item.get("summary")
        category, published, content = item.get("category"), item.get("datePublished"), item.get("contentMarkdown")
        if (not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug)
                or slug in seen or not isinstance(title, str) or not 8 <= len(title) <= 180
                or not isinstance(summary, str) or not 30 <= len(summary) <= 420
                or not isinstance(category, str) or not 2 <= len(category) <= 80
                or not isinstance(published, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", published)
                or not isinstance(content, str) or not 500 <= len(content) <= 50000
                or item.get("language") != "zh-CN"):
            fail("server article entry is malformed or exceeds its bound")
        try:
            dt.date.fromisoformat(published)
        except ValueError:
            fail("server article date is invalid: " + slug)
        seen.add(slug)
    return collection


def render_inline(markdown):
    held = []

    def hold(value):
        token = "@@DSH_ARTICLE_TOKEN_" + str(len(held)) + "@@"
        held.append(value)
        return token

    def link(match):
        label, href = match.group(1), match.group(2)
        try:
            parsed = urlsplit(href)
            valid = parsed.scheme in ("http", "https") and bool(parsed.hostname) and not parsed.username and not parsed.password
        except ValueError:
            valid = False
        if not valid:
            return label
        return hold('<a href="' + html.escape(href, quote=True) + '" target="_blank" rel="noopener noreferrer">'
                    + html.escape(label, quote=True) + "</a>")

    text = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", link, str(markdown))
    code_pattern = re.escape(BT) + r"([^" + re.escape(BT) + r"]+)" + re.escape(BT)
    text = re.sub(code_pattern, lambda match: hold("<code>" + html.escape(match.group(1), quote=True) + "</code>"), text)
    text = re.sub(r"\*\*(.+?)\*\*", lambda match: hold("<strong>" + html.escape(match.group(1), quote=True) + "</strong>"), text)
    text = re.sub(r"\*([^*]+)\*", lambda match: hold("<em>" + html.escape(match.group(1), quote=True) + "</em>"), text)
    text = html.escape(text, quote=True).replace("\n", "<br>")
    for index, value in enumerate(held):
        text = text.replace("@@DSH_ARTICLE_TOKEN_" + str(index) + "@@", value)
    return text


def render_markdown(markdown):
    output, paragraph, quote, code = [], [], [], []
    list_type, fenced, skip_first_heading = None, False, True

    def flush_paragraph():
        if paragraph:
            output.append("<p>" + render_inline("\n".join(paragraph)) + "</p>")
            paragraph.clear()

    def close_list():
        nonlocal list_type
        if list_type:
            output.append("</" + list_type + ">")
        list_type = None

    def flush_quote():
        if quote:
            output.append("<blockquote><p>" + render_inline("\n".join(quote)) + "</p></blockquote>")
            quote.clear()

    for raw in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if line.startswith(BT * 3):
            flush_paragraph(); close_list(); flush_quote()
            if not fenced:
                code = []; fenced = True
            else:
                output.append("<pre><code>" + html.escape("\n".join(code), quote=True) + "</code></pre>")
                fenced = False
            continue
        if fenced:
            code.append(raw); continue
        if not line:
            flush_paragraph(); close_list(); flush_quote(); continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph(); close_list(); flush_quote()
            if len(heading.group(1)) == 1 and skip_first_heading:
                skip_first_heading = False; continue
            skip_first_heading = False
            level = min(3, max(2, len(heading.group(1))))
            output.append(f"<h{level}>" + render_inline(heading.group(2)) + f"</h{level}>")
            continue
        if re.fullmatch(r"(?:---+|\*\*\*+)", line):
            flush_paragraph(); close_list(); flush_quote(); output.append("<hr>"); continue
        if line.startswith(">"):
            flush_paragraph(); close_list(); quote.append(re.sub(r"^>\s?", "", line)); continue
        item = re.match(r"^(?:([-*+])|(\d+)[.)])\s+(.+)$", line)
        if item:
            flush_paragraph(); flush_quote()
            next_type = "ol" if item.group(2) else "ul"
            if list_type != next_type:
                close_list(); output.append("<" + next_type + ">"); list_type = next_type
            output.append("<li>" + render_inline(item.group(3)) + "</li>")
            continue
        close_list(); flush_quote(); paragraph.append(line)
    flush_paragraph(); close_list(); flush_quote()
    return "\n".join(output)


def replace_required(text, marker, value, label):
    if marker not in text:
        fail("article template marker is missing: " + label)
    return text.replace(marker, value)


def relative_href(page_relative, target_relative):
    href = posixpath.relpath(target_relative, posixpath.dirname(page_relative) or ".")
    return "./" if href == "." else href.rstrip("/") + "/"


def article_nav(page_relative, current):
    current_attr = ' aria-current="page"' if current else ""
    return ('<a href="' + html.escape(relative_href(page_relative, "articles"), quote=True)
            + '" data-i18n="nav.articles"' + current_attr + '>DSH 实战与观察</a>')


def ensure_footer_links(page, page_relative):
    start = page.find('<nav class="footer-nav"')
    end = page.find("</nav>", start) if start >= 0 else -1
    if start < 0 or end < 0:
        fail("article page footer navigation is missing")
    fragment = page[start:end + 6]
    found = re.search(r'<section class="footer-nav-group">[\s\S]*?</section>', fragment)
    if not found:
        fail("article page quick navigation group is missing")
    quick = found.group(0)
    additions = []
    for route, label, key in (("faq", "常见问题", "nav.faq"), ("about", "关于我们", "nav.about")):
        if not re.search(r'href="(?:\.\./)*' + route + r'/"', quick):
            additions.append(f'<a href="{html.escape(relative_href(page_relative, route), quote=True)}" data-i18n="{key}">{label}</a>')
    submit = "https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml"
    if submit not in quick:
        additions.append(f'<a href="{submit}" target="_blank" rel="noreferrer" data-analytics-event="plugin_submission_open" data-analytics-item="footer"><span data-i18n="nav.submit">提交插件</span><i class="nav-external" aria-hidden="true">↗</i></a>')
    if not additions:
        return page
    updated_fragment = fragment.replace(quick, quick.replace("</section>", "".join(additions) + "</section>"), 1)
    return page[:start] + updated_fragment + page[end + 6:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--site-root", required=True, help="candidate release marketplace directory")
    parser.add_argument("--build-manifest", required=True)
    args = parser.parse_args()
    source, site_root = Path(args.source_dir).resolve(strict=True), Path(args.site_root).resolve(strict=True)
    build = json.loads(Path(args.build_manifest).resolve(strict=True).read_text(encoding="utf-8"))
    data, hashes, source_set_hash = source_snapshot(source)
    collection = validate_collection(data["articles.json"])
    origin, alternate = build.get("siteOrigin"), build.get("alternateOrigin")
    runtime_version = build.get("runtimeAssetVersion")
    if origin not in ("https://dsh.store", "https://dsh-store.cn") or not isinstance(alternate, str) or alternate == origin:
        fail("static build origin metadata is invalid for server article generation")
    if not re.fullmatch(r"[a-f0-9]{12}", str(runtime_version or "")):
        fail("static build runtime version is missing or invalid")
    builder = build.get("serverArticles", {}).get("builder", {})
    if builder.get("path") != "scripts/build-server-articles.py" or not re.fullmatch(r"[a-f0-9]{64}", str(builder.get("sha256", ""))):
        fail("static release does not declare the pinned server article builder")
    host, domestic = urlsplit(origin).hostname, urlsplit(origin).hostname == "dsh-store.cn"
    output = site_root / "articles"
    if output.exists() or output.is_symlink():
        fail("article output path already exists in the candidate release")
    for path in (site_root / "robots.txt", site_root / "sitemap.xml", site_root / "index.html"):
        if not path.is_file() or path.is_symlink():
            fail("candidate static site is incomplete for article generation")

    articles = collection["articles"]
    output.mkdir(parents=True, mode=0o755)
    index_template = data["index.template.html"].decode("utf-8").replace("https://dsh.store", origin)
    cards = []
    for item in articles:
        date = dt.date.fromisoformat(item["datePublished"])
        shown = f"{date.year}年{date.month}月{date.day}日"
        slug, title = html.escape(item["slug"], quote=True), html.escape(item["title"], quote=True)
        cards.append('<article class="article-card"><div class="article-card-meta"><time datetime="'
                     + html.escape(item["datePublished"], quote=True) + '">' + shown + '</time><span>'
                     + html.escape(item["category"], quote=True) + '</span></div><h3><a href="./' + slug + '/">'
                     + title + '</a></h3><p>' + html.escape(item["summary"], quote=True)
                     + '</p><a href="./' + slug + '/">阅读文章 <span aria-hidden="true">↗</span></a></article>')
    collection_schema = {
        "@context": "https://schema.org", "@type": "CollectionPage",
        "@id": origin + "/articles/#collection", "url": origin + "/articles/",
        "name": collection["collectionTitle"], "description": collection["collectionDescription"],
        "inLanguage": "zh-CN",
        "isPartOf": {"@type": "WebSite", "@id": origin + "/#website", "name": "DSH STORE", "url": origin + "/"},
        "mainEntity": {"@type": "ItemList", "itemListOrder": "https://schema.org/ItemListOrderDescending",
            "numberOfItems": len(articles), "itemListElement": [
                {"@type": "ListItem", "position": index + 1, "url": origin + "/articles/" + item["slug"] + "/",
                 "name": item["title"], "description": item["summary"]} for index, item in enumerate(articles)]}}
    index_template = replace_required(index_template, "<!-- DSH_ARTICLE_COLLECTION_SCHEMA -->",
        '<script type="application/ld+json">' + safe_json(collection_schema) + "</script>", "collection schema")
    index_template = replace_required(index_template, "<!-- DSH_STATIC_ARTICLE_LIST -->", "\n".join(cards), "article list")
    index_template, count = re.subn(r'(<b id="article-count">)[^<]*(</b>)', r'\g<1>' + str(len(articles)) + r'\2', index_template, count=1)
    if count != 1:
        fail("article count marker is missing")
    (output / "articles.css").write_bytes(data["articles.css"])
    (output / "index.html").write_text(index_template, encoding="utf-8")

    detail_template = data["article.template.html"].decode("utf-8")
    for item in articles:
        route, url = "/articles/" + item["slug"] + "/", origin + "/articles/" + item["slug"] + "/"
        schema = {
            "@context": "https://schema.org", "@type": "Article", "@id": url + "#article",
            "headline": item["title"], "description": item["summary"], "datePublished": item["datePublished"],
            "inLanguage": item["language"], "articleSection": item["category"],
            "keywords": ["DeepSeek Harness", "DSH", "DSH 插件", item["category"]],
            "isAccessibleForFree": True, "mainEntityOfPage": {"@type": "WebPage", "@id": url},
            "publisher": {"@type": "Organization", "name": "DSH STORE", "url": origin + "/"}}
        page = detail_template
        values = {
            "<!-- ARTICLE_DESCRIPTION -->": html.escape(item["summary"], quote=True),
            "<!-- ARTICLE_DATE -->": html.escape(item["datePublished"], quote=True),
            "<!-- ARTICLE_TITLE -->": html.escape(item["title"], quote=True),
            "<!-- ARTICLE_URL -->": html.escape(url, quote=True),
            "<!-- ARTICLE_IMAGE -->": html.escape(origin + "/dsh-store-icon.png", quote=True),
            "<!-- ARTICLE_CATEGORY -->": html.escape(item["category"], quote=True),
            "<!-- ARTICLE_SCHEMA -->": '<script type="application/ld+json">' + safe_json(schema) + "</script>",
            "<!-- ARTICLE_CONTENT -->": render_markdown(item["contentMarkdown"]),
            "<!-- ASSET_VERSION -->": runtime_version,
        }
        for marker, value in values.items():
            page = replace_required(page, marker, value, marker)
        target = output / item["slug"] / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        target.write_text(page, encoding="utf-8")

    icp = build.get("icp") or ""
    if icp and (not isinstance(icp, str) or not re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9()（）-]{4,80}", icp)):
        fail("static build ICP metadata is invalid")
    alt_host = urlsplit(alternate).hostname
    label, code = ("国内站", "CN") if alt_host == "dsh-store.cn" else ("国际站", "INTL")
    aria = "切换到国内站 / Switch to China site" if code == "CN" else "切换到国际站 / Switch to international site"
    event = "domestic" if code == "CN" else "international"
    alt_markup = (f'<a class="site-switch-link" href="{html.escape(alternate, quote=True)}/" aria-label="{aria}" '
                  f'data-analytics-event="alternate_site_open" data-analytics-item="{event}"><span>{label}</span>'
                  f'<small>{code}</small><i aria-hidden="true">↗</i></a>')
    icp_markup = ('<a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">'
                  + html.escape(icp, quote=True) + "</a>") if icp else ""
    verification_code = ""
    if domestic and build.get("baiduSiteVerification") == "configured":
        home = (site_root / "index.html").read_text(encoding="utf-8")
        match = re.search(r'<meta name="baidu-site-verification" content="([A-Za-z0-9_-]{8,128})">', home)
        if not match:
            fail("configured Baidu site verification code is missing from candidate homepage")
        verification_code = match.group(1)
    baidu_meta = f'<meta name="baidu-site-verification" content="{verification_code}">' if verification_code else ""
    umami_id = "763ad43e-f5c9-4342-9a82-8366d1ea90df" if domestic else "c0cf0ce3-b77c-4570-9573-59c07a583950"
    umami = ("<script>\n(function () {\n  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;\n"
             "  var script = document.createElement('script');\n  script.src = 'https://aiaiai.help/umami/script.js';\n"
             "  script.async = true;\n  script.dataset.websiteId = '" + umami_id + "';\n"
             "  script.dataset.hostUrl = 'https://aiaiai.help/umami';\n  script.dataset.domains = '" + host + "';\n"
             "  script.dataset.doNotTrack = 'true';\n  script.dataset.excludeSearch = 'true';\n"
             "  script.dataset.excludeHash = 'true';\n  document.head.appendChild(script);\n})();\n</script>")
    baidu_tongji = ("<script>\nvar _hmt = _hmt || [];\n(function() {\n  var hm = document.createElement(\"script\");\n"
                    "  hm.src = \"https://hm.baidu.com/hm.js?7c34f1fd076e8f052b6a6f746ab1135d\";\n"
                    "  var s = document.getElementsByTagName(\"script\")[0];\n  s.parentNode.insertBefore(hm, s);\n})();\n</script>") if domestic else ""

    def finalize(page, relative, current):
        page = page.replace("https://dsh.store", origin)
        page = replace_required(page, "<!-- DSH_BAIDU_VERIFICATION -->", baidu_meta, "Baidu verification")
        hreflang = f'<link rel="alternate" hreflang="zh-CN" href="{html.escape(origin + "/articles/", quote=True)}">'
        page = replace_required(page, "<!-- DSH_HREFLANG -->", hreflang, "hreflang")
        page = replace_required(page, "<!-- DSH_ALTERNATE_SITE -->", article_nav(relative, current), "article navigation")
        page = page.replace("<!-- DSH_FRIEND_SISTER_SITE -->", "")
        page = replace_required(page, "<!-- DSH_ICP -->", alt_markup + icp_markup, "site switch / ICP")
        page = page.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-default-locale="zh" data-fixed-locale="zh-CN">', 1)
        traffic = posixpath.relpath("traffic.js", posixpath.dirname(relative) or ".")
        analytics = (baidu_tongji + "\n" if baidu_tongji else "") + f'<script type="module" src="{traffic}?v={runtime_version}"></script>\n{umami}'
        page = replace_required(page, "</head>", analytics + "\n</head>", "article analytics head")
        return ensure_footer_links(page, relative)

    sitemap_urls = [origin + "/articles/"] + [origin + "/articles/" + item["slug"] + "/" for item in articles]
    (output / "index.html").write_text(finalize((output / "index.html").read_text(encoding="utf-8"), "articles/index.html", True), encoding="utf-8")
    for item in articles:
        path = output / item["slug"] / "index.html"
        relative = "articles/" + item["slug"] + "/index.html"
        path.write_text(finalize(path.read_text(encoding="utf-8"), relative, True), encoding="utf-8")

    transformed = 0
    for path in sorted(site_root.rglob("*.html")):
        if path.is_symlink() or not path.is_file():
            fail("candidate site contains an unsafe HTML path")
        page = path.read_text(encoding="utf-8")
        if ARTICLE_NAV_MARKER not in page:
            continue
        relative = path.relative_to(site_root).as_posix()
        href = relative_href(relative, "articles")
        label = "DSH Field Notes" if 'data-default-locale="en"' in page else "DSH 实战与观察"
        link = f'<a href="{html.escape(href, quote=True)}" data-i18n="nav.articles">{label}</a>'
        path.write_text(page.replace(ARTICLE_NAV_MARKER, link, 1), encoding="utf-8")
        transformed += 1
    if transformed < 8:
        fail("candidate static pages are missing their server article navigation slots")

    rows = []
    for index, url in enumerate(sitemap_urls):
        lastmod = dt.date.today().isoformat() if index == 0 else articles[index - 1]["datePublished"]
        changefreq, priority = ("weekly", "0.8") if index == 0 else ("monthly", "0.7")
        rows.append(f'  <url><loc>{html.escape(url)}</loc><lastmod>{lastmod}</lastmod><changefreq>{changefreq}</changefreq><priority>{priority}</priority><mobile:mobile type="pc,mobile" /></url>')
    article_sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:mobile="http://www.baidu.com/schemas/sitemap-mobile/1/">\n'
        + "\n".join(rows) + "\n</urlset>\n")
    (output / "sitemap.xml").write_text(article_sitemap, encoding="utf-8")
    robots_path = site_root / "robots.txt"
    robots = robots_path.read_text(encoding="utf-8")
    article_sitemap_line = "Sitemap: " + origin + "/articles/sitemap.xml"
    if article_sitemap_line not in robots:
        if re.search(r"^Sitemap: .*?/articles/sitemap\.xml\s*$", robots, re.MULTILINE):
            fail("robots.txt declares an unexpected article sitemap origin")
        robots_path.write_text(robots.rstrip() + "\n" + article_sitemap_line + "\n", encoding="utf-8")

    output_root = site_root.parent
    state_dir = output_root / "server-state"
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o755)
    generated_files = {}
    for path in sorted(output.rglob("*")):
        if path.is_symlink():
            fail("generated article tree contains a symlink")
        if path.is_file():
            relative = path.relative_to(output_root).as_posix()
            raw = path.read_bytes()
            generated_files[relative] = {"sha256": sha256(raw), "size": len(raw)}
    state = {
        "schemaVersion": 1, "migrationPlanId": MIGRATION_PLAN_ID,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "siteOrigin": origin, "articleCount": len(articles), "articleSlugs": [item["slug"] for item in articles],
        "sourceSetSha256": source_set_hash, "sourceSha256": hashes["articles.json"],
        "sourceAssetSha256": {name: hashes[name] for name in SOURCE_FILES if name != "articles.json"},
        "files": generated_files,
    }
    state_path = state_dir / "articles-manifest.json"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for root in (output, state_dir):
        for directory, _, files in os.walk(root):
            os.chmod(directory, 0o755)
            for filename in files:
                os.chmod(Path(directory) / filename, 0o644)
    print(f"SERVER_ARTICLES_OK origin={origin} articles={len(articles)} source={source_set_hash} pages={transformed}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        fail("server article build failed: " + str(error))
