# Developing a ToolDeck tool package

English | [简体中文](tool-development.zh-CN.md) · [Project overview](../README.md)

## Build a first package

Create a folder with two UTF-8 files. Save the following as `manifest.yaml`. It declares one action with a required text field.

~~~yaml
manifestVersion: 1
id: org.example.greeting
name: { en: Greeting, zh-CN: 问候 }
version: "1.0.0"
hostApi: "^1.0.0"
runtime: { kind: python, version: ">=3.10.0 <4.0.0", source: system }
actions:
  greet:
    name: { en: Greet, zh-CN: 打招呼 }
    entry: greet.py
    params:
      name:
        required: true
        schema: { type: string, minLength: 1 }
        ui:
          label: { en: Name, zh-CN: 姓名 }
          placeholder: { en: Enter a name, zh-CN: 请输入姓名 }
~~~

Save its entry point as `greet.py` next to the manifest:

~~~python
def main(ctx):
    name = ctx.params["name"]
    message = {"en": "Hello", "zh-CN": "你好"}.get(ctx.locale, "Hello")
    ctx.output({"message": f"{message}, {name}!"})
~~~

Zip the two files with `manifest.yaml` at the archive root. Import the ZIP, install the Python environment, choose **Greet**, enter a name and run. The result pane will show a message in the application's display language. For working packages with multiple actions, see the [Python](../examples/python-example/), [Node.js](../examples/node-example/), [Bash](../examples/bash-example/) and [PowerShell](../examples/pws-example/) examples.

## Package identity and environment

Keep the same `id` across releases and increase the SemVer `version` for each upgrade. Use a lowercase reverse-domain ID such as `org.example.greeting`. Action, field and document keys start with an ASCII letter and can contain letters, digits and underscores. Each action has its own `name` and unique `entry` file. Entries can import shared code. Package paths are relative to the root and use `/`; absolute paths and parent traversal are rejected.

| Top-level key | Required | Value and purpose |
| --- | --- | --- |
| `manifestVersion` | Yes | Integer `1`, the package format version. |
| `id` | Yes | Stable tool identifier; also identifies its settings and persistent data. |
| `name` | Yes | Display text or a locale map; a map with no matching translation falls back to the ID. |
| `version` | Yes | Tool release as a SemVer string, e.g. `"1.2.0"`. |
| `description` | No | Summary shown under the tool name; accepts translated text. |
| `icon` | No | Relative image path inside the package; otherwise the UI uses the tool initial. |
| `hostApi` | Yes | SemVer range that includes the current execution protocol version, `1.0.0`. |
| `platforms` | No | Nonempty list of OS/architecture objects. See below. |
| `runtime` | Yes | One object with `kind`, `version` (range) and `source`. |
| `dependencies` | No | Package manager and dependency files for the chosen runtime. |
| `settings` | No | Field map for persistent, tool-wide settings. |
| `actions` | Yes | Nonempty map of action IDs to declarations. |
| `docs` | No | List of bundled Markdown documents; each has `id`, `title`, `path` and optional `locale`. |

Each action declares a package-relative `entry`. Give it a display `name`, an optional `description`, a `params` field map and, if needed, `execution: {timeoutSeconds: 60}`. The entry must exist and resolve to a different file for every action. Document titles are strings; localize a title by declaring it in the corresponding document entry.

### Runtime and installation details

| Manifest field | What to declare |
| --- | --- |
| `manifestVersion`, `hostApi` | Use manifest version 1. Set the compatible execution protocol range separately from the tool version. |
| `platforms` | Omit for all platforms, or list entries such as `{os: linux, arch: [amd64, arm64]}`. Systems are `windows`, `macos` and `linux`. Omitting `arch` allows all architectures for that system. |
| `runtime` | Choose one of `python`, `nodejs`, `bash`, `powershell`. Declare a SemVer range and `source: system`. PowerShell uses `pwsh`. |
| `dependencies` | For Python use `{manager: pip, file: requirements.txt}`. uv creates a private `.venv` even when this section is omitted. For Node.js use `{manager: npm, file: package.json}` and optionally `lockfile: package-lock.json`. Put declared files at the package root. |

## Design the form

Put reusable configuration in top-level `settings` and per-run inputs in an action's `params`. Both are maps from field key to declaration. Each field needs a `schema`. Set `required: true` to require its presence. A top-level `schema.default` fills a missing value; `ui.placeholder` only supplies a hint. Use `secret: true` to mask a setting in the UI; saved tool settings are stored in `.tooldeck/settings.json`.

Supported schema types are string, number, integer, boolean, array, object and null. Constraints include `enum`, `const`, numeric bounds, string length and pattern, array item type, item counts and uniqueness, and object properties, required keys and boolean `additionalProperties`. The host validates supplied values before running the script.

### Field declaration reference

| Key | Meaning |
| --- | --- |
| `schema` | Required JSON Schema for the submitted value. Use `type`, `default`, `const` or `enum`; string constraints include `minLength`, `maxLength`, `pattern`; numeric bounds are `minimum`, `maximum`. |
| `schema.items`, `minItems`, `maxItems`, `uniqueItems` | Define array elements, cardinality and uniqueness. For objects use `properties`, a `required` array of property names, and `additionalProperties`. |
| `required` | Field-level boolean, default false. Tests presence; pair it with `minLength: 1` or `minItems: 1` when an empty value is unacceptable. Explicit null is validated against the schema. |
| `secret` | Boolean, default false. Enables masking and a visibility toggle for a password input. |
| `ui` | Controls presentation: `component`, `label`, `description` (label tooltip), `placeholder`, plus picker-specific `mode`, `multiple`, `filters`, or select-specific `options`. |
| `path` | `kind: file` or `directory` plus optional `mustExist` (default false). Existing targets must match the declared kind. Each path in an array is checked. |
| `availableWhen` | Action parameters only. Reads values from the same action, including defaults for missing keys. |

### Choosing a UI component

| Component | Schema and behavior |
| --- | --- |
| `text` | Single-line string, e.g. a title or language code. Use a placeholder for an example and `schema.default` for a prefilled value. |
| `textarea` | Multiline string; preserves entered text and line breaks. Useful for prompts or notes. |
| `number` | Numeric input. Use `type: integer` for whole numbers or `number` for decimals. Clearing it removes the supplied value. |
| `checkbox` | Boolean toggle. Set `default: false` if the script needs an explicit false when untouched. |
| `select` | Dropdown in `schema.enum` order. Optional `ui.options` entries pair an enum `value` with a display `label`; each value may appear once. The script receives the original JSON type. |
| `tags` | For a string array, use `items: {type: string}`. Enter a JSON array such as `["draft", "review"]` in the multiline editor. |
| `file` | Single path string, typed or chosen. `mode: open` picks an input; `save` opens a save dialog. In save mode, a filename without an extension gets the first configured filter extension. |
| `file` with `multiple: true` | Open mode only. Picking again appends new paths, removes duplicates and preserves selection order. Each list entry can be removed individually. |
| `directory` | Single directory path. Browse to an existing directory or type an absolute destination. Allow a future directory with `mustExist: false` and create it in the script. |
| `password` | Use a string schema **and** `secret: true` to mask the input. The script receives its string value. |
| JSON editor | With no explicit component, arrays and objects use a multiline editor that parses JSON. Malformed JSON is reported in the form. |

When `component` is omitted, an enum takes precedence, followed by checkbox for booleans, number for numbers/integers, JSON for arrays/objects, and text otherwise.

### File selection and conditional fields

Under `ui`, set a label, description and placeholder as needed. Available components are `text`, `textarea`, `number`, `checkbox`, `select`, `tags`, `file`, `directory` and `password`. Here are three entries for an action's `params`:

~~~yaml
sources:
  required: true
  schema: { type: array, items: { type: string }, minItems: 1, uniqueItems: true }
  ui:
    component: file
    mode: open
    multiple: true
    filters: [{ name: Audio, extensions: [mp3, wav] }]
  path: { kind: file, mustExist: true }
mode:
  schema: { type: string, enum: [copy, encode], default: copy }
  ui:
    component: select
    options:
      - { value: encode, label: { en: Re-encode, zh-CN: 重新编码 } }
quality:
  required: true
  availableWhen: { op: eq, key: mode, value: encode }
  schema: { type: integer, minimum: 0, maximum: 51 }
~~~

- File or directory pickers return absolute paths. Use `mode: save` for a destination and `mode: open` for inputs. Multiple selection requires a file picker in open mode and an array of strings. Filter extensions omit the leading dot. Use `path.kind` and `mustExist` to validate the selected paths. The script decides whether to create or overwrite outputs.
- A select submits the original enum value. Option labels affect display only. An action parameter's `availableWhen` reads other parameters from the same action. Hidden parameters are optional; supplied values still undergo validation and can reach the script.
- Compare with `eq`, `not`, `gt`, `gte`, `lt` or `lte`. Use `{op: 'null', key: x}` for missing or null, `notNull` for the inverse, and `empty` for missing, null or the empty string. Combine conditions using `{op: and, cond: [...]}` or `or`; nesting is supported.

## Run an action and report results

Each action starts a separate process in the tool directory. Use `execution.timeoutSeconds` on the action for a time limit (zero or omitted means no tool-defined limit). Scripts should take inputs from the host and finish after completing the action. An uncaught exception or nonzero exit fails a run.

**Python and Node.js.** Define `main(ctx)` in Python or export `main(ctx)` in Node.js. Both can be asynchronous. Read `ctx.params`, `ctx.settings` and `ctx.locale`. Metadata includes `apiVersion`, `runId`, `actionId`, `toolId` and `toolVersion`. Use `ctx.paths.tool` for package files, `ctx.paths.data` for persistent state and `ctx.paths.temp` for scratch files. Take the destination for user outputs from an action parameter.

~~~python
ctx.log("Processing")
ctx.progress({"value": 1, "total": 2})
ctx.table({"columns": [{"key": "name"}], "rows": [{"name": "Ada"}]})
ctx.link({"kind": "directory", "target": ctx.paths.data})
~~~

Use `ctx.output(value)` for JSON results. `ctx.log(message, level)` defaults to info and also accepts debug, warning or error. Progress accepts a message alone or a finite value and positive total with the value between zero and total. Tables take unique column keys, optional labels and row objects. Links accept a file or directory with an absolute path, or a URL with an HTTP(S) target and an optional label. File links reveal the file in its directory. Ordinary stdout/stderr becomes text logs. ToolDeck records run logs, so keep secrets out of any output.

### Reporting a table with `ctx.table`

Use a table when one action produces a list, such as generated files and their sizes. Each call appends a separate table to the run output. Python and Node.js use the same JSON shape.

| Member | Contract |
| --- | --- |
| `columns` | Nonempty array in display order. Each column requires a unique, nonempty string `key` and can have a string `label`. Omitting the label displays the key. |
| `rows` | Array of objects in display order. An empty array displays the header. The renderer looks up each cell by column key and skips extra properties. |
| Cell | Missing or null is blank. Strings, finite numbers and booleans display as text. Arrays and ordinary objects display as JSON. All data must be JSON-serializable. |
| Clickable cell | Supply `{kind: "file" or "directory", target: absolutePath, label: optionalText}`. Clicking reveals a file or opens a directory. The path is displayed when no label is supplied. Use a standalone `ctx.link` for a website URL. |

~~~python
from pathlib import Path

def main(ctx):
    folder = Path(ctx.paths.data)
    report = folder / "report.txt"
    report.write_text("Done\n", encoding="utf-8")
    ctx.table({
        "columns": [
            {"key": "artifact", "label": "Artifact"},
            {"key": "bytes", "label": "Bytes"},
        ],
        "rows": [
            {"artifact": {"kind": "file", "target": str(report), "label": report.name},
             "bytes": report.stat().st_size},
            {"artifact": {"kind": "directory", "target": str(folder), "label": "Folder"}},
        ],
    })
~~~

This creates two clickable rows. The folder's size is blank because its row omits `bytes`. For the equivalent JavaScript entry, see the [Node.js table example](../examples/node-example/table.mjs). To translate column headings and link labels, choose their strings using `ctx.locale` before calling `ctx.table`.

### Shell scripts

**Bash and PowerShell.** Read `TOOLDECK_LOCALE`, `TOOLDECK_PARAM_<KEY>` and `TOOLDECK_SETTING_<KEY>` from the environment. Keys are uppercased without inserting separators. Choose keys that remain unique after uppercasing. Strings pass through as text, booleans as `true`/`false`, numbers as JSON numbers and arrays, objects or null as compact JSON. Missing fields have no variable. Use quoted shell expansions or PowerShell's `$env:NAME`; compare booleans explicitly. Write normal output to stdout and diagnostics to stderr. The host also supplies `TOOLDECK_TOOL_DIR`, `TOOLDECK_DATA_DIR`, `TOOLDECK_TEMP_DIR`, `TOOLDECK_RUN_ID`, `TOOLDECK_ACTION_ID`, `TOOLDECK_TOOL_ID`, `TOOLDECK_TOOL_VERSION` and `TOOLDECK_API_VERSION`.

## Localize and test the package

The [Python example](../examples/python-example/manifest.yaml) and [Bash example](../examples/bash-example/manifest.yaml) use locale maps for labels and provide English and Simplified Chinese guides. Their scripts select output text using the application locale. The [Node.js example](../examples/node-example/manifest.yaml) and [PowerShell example](../examples/pws-example/manifest.yaml) use plain English strings that display in either locale.

Tool and action names and descriptions, field labels, descriptions, placeholders and option labels accept either plain text or a locale map. A map resolves the current locale first, then English. If both are missing, names fall back to IDs, field labels to keys and option labels to values. Descriptions and placeholders are left blank.

For each translated Markdown document, reuse its ID and declare a separate locale and file. The reader chooses the current locale, then English, then a document with no locale. Use explicit Markdown links for clickable references.

~~~yaml
docs:
  - { id: guide, locale: en, title: User guide, path: README.md }
  - { id: guide, locale: zh-CN, title: 使用说明, path: README.zh.md }
~~~

Before distributing a ZIP, import it into ToolDeck, install the environment and run each action. Check a missing required input, both display languages and the saved output location. For updates, test importing a higher version over the previous one. The [application guide](user-guide.md) describes the import and upgrade flow.
