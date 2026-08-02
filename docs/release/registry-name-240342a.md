# MDVE 1.0.0 registry-name check

Candidate: `240342afb2daf52504949a4e82629516a750a48e`

Checked at: `2026-08-02T02:17:43Z`

Command:

```text
npm view mdve@1.0.0 version --json
```

The npm registry returned `E404 Not Found` for `https://registry.npmjs.org/mdve`.
No `mdve@1.0.0` package is currently published, so the name was unclaimed at
this check. The exact candidate tarball also passed
`npm publish <tarball> --dry-run --access public --tag next`, reporting the
expected 75-file manifest, package name, version, public access, and `next`
dist-tag without contacting the registry. This is still only local
name-availability and packaging evidence; it is not registry install,
signature, provenance, or trusted-publisher evidence.
