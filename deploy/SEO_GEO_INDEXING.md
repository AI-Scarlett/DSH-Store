# DSH STORE search indexing runbook

Canonical property: `https://dsh.store/`

## Automated path

1. Publish the website and verify the canonical pages, `robots.txt`, `sitemap.xml`, `llms.txt`, the DSH plugin guide, and the public IndexNow key file.
2. Run `node scripts/submit-indexnow.mjs` only after public readback succeeds.
3. Treat HTTP 200 or 202 as accepted submission, not proof of crawling, indexing, or ranking.

## Google Search Console

1. Add the domain property `dsh.store` and complete DNS ownership verification.
2. Submit `https://dsh.store/sitemap.xml` in the Sitemaps report.
3. Use URL Inspection to request indexing for the homepage first, then the catalog, DSH plugin guide, build, FAQ, and about pages.
4. Record discovered, crawled, indexed, and excluded states separately. Repeated requests do not accelerate crawling.

## Bing Webmaster Tools

1. Add and verify `dsh.store`, or import the verified Google Search Console property.
2. Submit `https://dsh.store/sitemap.xml` and confirm that the IndexNow submission for `/dsh-plugins/` appears in the IndexNow report.
3. Inspect the homepage URL and keep submitted, crawled, indexed, and ranking states separate.

## Baidu Search Resource Platform

1. Add and verify `https://dsh.store/` in [Baidu Search Resource Platform](https://ziyuan.baidu.com/site/index).
2. Submit `https://dsh.store/sitemap.xml` through 资源提交 → 普通收录 → Sitemap. The sitemap is a URL-list sitemap for this property only and marks the responsive pages as `pc,mobile`.
3. Use 资源提交 → 普通收录 → API提交 or 手动提交 for the homepage, `/plugins/`, `/dsh-plugins/`, `/build/`, `/faq/`, and `/about/`. Keep any Baidu token outside source control and send only canonical URLs.
4. Inspect 抓取诊断, Robots, 索引量, and 流量与关键词 after submission. A successful submission accelerates discovery but does not guarantee crawling, inclusion, or ranking.

## Monitoring

- Check branded queries: `DSH STORE`, `DSH.STORE`, `dsh.store`, and `DeepSeek Harness 插件商城`.
- Check `site:dsh.store` separately on Bing, Google, and Baidu.
- Review crawler requests in the existing DSH STORE access log and keep bot reachability separate from index status.
- Build legitimate external references from the GitHub repository, README, release notes, X profile, and relevant DSH ecosystem pages. Do not buy links or create doorway pages.
