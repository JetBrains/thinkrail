---
id: submodule-server-extension-catalog
type: submodule-design
status: active
title: extension-catalog — the community catalog for in-app Browse
parent: module-server
depends-on: [module-contracts]
references: [module-thinkrail-extensions, module-website]
---

## Responsibility

Read the community extension catalog the website publishes (`catalog.json`, [[module-thinkrail-extensions]]
§ Installed extensions → Catalog) for Settings → Extensions → Browse, validate it and hand it to the host's
`extensions.browse` with each listing marked when an installed extension already carries its name. The
browser never talks to thinkrail.ai: the host fetches, so the app's origin, CSP and offline rules stay the
host's.

## Boundary

- **Owns:** the source URL (`https://thinkrail.ai/extensions/catalog.json`, overridden by
  `THINKRAIL_EXTENSION_CATALOG_URL`), the read (`ExtensionCatalogSource`: fetch or file read, timeout, size
  cap, cache), the strict validator `parseExtensionCatalog`, and `browseExtensions(installedNames, { force })`.
- **Public surface (barrel):** `browseExtensions`, `ExtensionCatalogSource`, `extensionCatalogSource`,
  `parseExtensionCatalog`, `catalogUrl`, `EXTENSION_CATALOG_URL`, `EXTENSION_CATALOG_URL_ENV`,
  `CATALOG_CACHE_MS`, `CATALOG_TIMEOUT_MS`, `ExtensionCatalog`, `CatalogSourceOptions`, and the test reset.
- **Allowed deps:** `contracts` types, `@thinkrail/shared/codedError`, Node `fs`/`url`, and `fetch` for the
  catalog URL only — the one outbound request this module makes. It carries no user data, only the host's IP.
- **Forbidden:** importing `host`, `extensions` or `agent`. The host passes in the installed names (from the
  installed runtime's records), so this module never learns what is installed by itself.

## Get right

- **Strict, whole-file validation.** `schema` must be `1`, `generatedAt` a date, and every listing well
  formed: a valid npm `name` (unique in the file), non-empty `version`, string `description` and `api`,
  `halves` a non-empty duplicate-free subset of `server`/`web`, `install` exactly `npm:<name>`, `npm` an
  https URL, `publishedAt` a date, and, when present, non-empty `title`/`author` and https
  `image`/`repository`. One bad listing rejects the file (`EXTENSION_CATALOG_INVALID`): it is our own build's
  output, so a bad shape means a broken publish, not a bad author. **Unknown fields are dropped, not
  rejected**, unlike the website's own build check: a field the site adds within `schema: 1` must not blank
  Browse for every older app. `api` is not interpreted here; the web client applies the extension API rule
  to it ([[submodule-web-extensions]]).
- **Coded failures the UI tells apart:** `EXTENSION_CATALOG_OFFLINE` (`PI_OFFLINE` set — the same switch pi
  and the package installer honour), `EXTENSION_CATALOG_UNREACHABLE` (network error, the 8-second timeout,
  an HTTP error status, an unreadable or missing file, an unsupported address) and
  `EXTENSION_CATALOG_INVALID` (not JSON, over 5 MB, or the wrong shape). Messages are short and fixed; the
  response body is never logged or echoed.
- **Cache:** one validated copy for five minutes; `force` refetches. Concurrent reads share one request; a
  failure is never cached and drops the copy it was refreshing, so the next read asks again and Browse never
  shows a list the host just failed to confirm. The `installed` flag is computed per call from the
  names the host passes, so it is fresh even from a cached file.
- **A `file:` override is read even under `PI_OFFLINE`**, because it is not a network request; that is how
  the browser suite serves a fixture catalog and simulates an unreachable one (a missing file) on a host
  that is otherwise offline.
