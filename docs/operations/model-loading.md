# Loading models and legacy saves

Startup source precedence is `model`, `example`, `text`, then `filename`.
An explicit source replaces the browser's saved model and tabs. With no source
parameter, the previous session is restored. The `diagramtype`, `readOnly`, and
`generateDefault` options apply to all sources.

- `?model=<id>` opens a saved model, including legacy saves imported below.
- `?example=AccessControl` opens a bundled example. Legacy library paths work too.
- `?text=class%20Example%20%7B%7D` opens URL-encoded source, as used by the manual.
  The manual's double-encoded plus signs (`%252B`) are also accepted.
  An explicitly empty `text` opens a blank model.
- `?filename=raw.githubusercontent.com/umple/umple/master/umpleonline/umplibrary/AccessControl.ump`
  fetches a public source file. Scheme-less URLs use HTTPS; explicit HTTP and
  HTTPS URLs are also accepted. Encode the whole filename value if it contains
  its own query parameters.

Source links remain in the address bar while editing a temporary model. Sharing
promotes it to a permanent model and replaces source parameters with `?model=`.
Load failures show an error instead of compiling source from an unrelated saved
session.

Remote files must be UTF-8 text, at most 1 MiB, on port 80 or 443. Fetches have a
10-second deadline and allow at most four redirects. Private, loopback,
link-local, and reserved network destinations are rejected, including on
redirects. Only the requested file is fetched; relative remote `use` dependencies
are not downloaded automatically.

## Importing legacy `ump/` directories

The backend reads models from `MODEL_STORE_PATH` (default `/data/models`). In the
production compose setup this is the host's `./data/models` directory. Copy each
legacy saved-model directory into that store **with its original directory
name**. For example:

```
legacy/ump/160101abc/model.ump  -> data/models/160101abc/model.ump
legacy/ump/160101abc/Other.ump  -> data/models/160101abc/Other.ump
```

Copy the source `.ump` files, including companion tabs. Keep a backup and do not
merge a legacy directory into an existing model with the same ID. Make the
copied files writable by the backend. Do not copy legacy temporary models
(`tmp*`) as permanent saves: temporary model cleanup still applies.

A directory with lowercase `model.ump` and no `tabs.json` is recognized as a
legacy save. Its main tab retains that filename, and additional top-level `.ump`
files become tabs in alphabetical order. Hidden compiler files, subdirectories,
and symlinks are excluded from discovery. Existing `tabs.json` takes precedence;
otherwise an exact uppercase `Model.ump` identifies a modern save. Stored layout
is hidden from the editor and preserved on subsequent saves.

Opening `https://<new-host>/?model=160101abc` now loads that model. Its original
ID remains unchanged, and the next compilation writes modern tab metadata. Old
links also require the original host/path to route or redirect to this frontend,
preserving the query string; that server routing is independent of importing the
model files. No connection to the legacy server is made at request time.
