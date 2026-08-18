# DSH STORE search indexing runbook

Canonical property: `https://dsh.store/`

## Automated path

1. Publish the website and verify the four canonical pages, `robots.txt`, `sitemap.xml`, `llms.txt`, and the public IndexNow key file.
2. Run `node scripts/submit-indexnow.mjs` only after public readback succeeds.
3. Treat HTTP 200 or 202 as accepted submission, not proof of crawling, indexing, or ranking.

## Google Search Console

1. Add the domain property `dsh.store` and complete DNS ownership verification.
2. Submit `https://dsh.store/sitemap.xml` in the Sitemaps report.
3. Use URL Inspection to request indexing for the homepage first, then the catalog, build, and about pages.
4. Record discovered, crawled, indexed, and excluded states separately. Repeated requests do not accelerate crawling.

## Bing Webmaster Tools

1. Add and verify `dsh.store`, or import the verified Google Search Console property.
2. Submit the sitemap and confirm that IndexNow submissions appear in the IndexNow report.
3. Inspect the homepage URL and keep submitted, crawled, indexed, and ranking states separate.

## Baidu Search Resource Platform

1. Add and verify `https://dsh.store/` in Baidu Search Resource Platform.
2. Submit `https://dsh.store/sitemap.xml` through 普通收录.
3. If the verified property exposes an API token, store it outside source control and submit only canonical URLs.
4. Treat successful submission as faster discovery only; it does not guarantee inclusion or display.

## Monitoring

- Check branded queries: `DSH STORE`, `DSH.STORE`, `dsh.store`, and `DeepSeek Harness 插件商城`.
- Check `site:dsh.store` separately on Bing, Google, and Baidu.
- Review crawler requests in the existing DSH STORE access log and keep bot reachability separate from index status.
- Build legitimate external references from the GitHub repository, README, release notes, X profile, and relevant DSH ecosystem pages. Do not buy links or create doorway pages.
