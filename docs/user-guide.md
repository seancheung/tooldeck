# Using ToolDeck

English | [简体中文](user-guide.zh-CN.md) · [Project overview](../README.md)

## Import and run your first tool

1. Choose **Import tool** at the bottom of the sidebar, or drop one ZIP onto the sidebar. Review the tool details and confirm the import. To try a bundled example, follow the [example build instructions](../README.md#run-from-source).
2. Select the tool and open **Environment**. Check the supported platforms, host API, runtime version and package requirements before installing.
3. Select **Install** if the tool needs an environment. Every Python tool gets a private `.venv`; uv uses a compatible local Python and installs packages only when the tool declares them. Node.js tools with dependencies use npm. Bash and PowerShell tools use the system shell.
4. Open **Docs** to read the tool's instructions. If **Tool settings** is available, configure reusable values such as executable paths and save them.
5. Open **Actions**, select an action and fill in its parameters. For a multi-file field you can add more files or remove individual entries. Changing a parameter may reveal other required fields. Choose an output path when the tool asks for one, then select **Run**.
6. Follow progress and logs in the result pane. Depending on the tool, results can include tables and clickable file or directory links. **Stop run** cancels an active job. A tool's own instructions specify whether a later run can resume interrupted work.

Use the sidebar search to find an imported tool. The star in the tool header adds it to **Favorites**.

## Application settings

Open **App settings** from the sidebar. The initial display language follows the system language when supported and otherwise defaults to English. Select English or Simplified Chinese and save to switch. A tool can supply translated field labels, documentation and script output.

Leave the Node.js and uv paths blank for automatic detection. If detection fails, select the executable or use **Detect again** after installing it. For Python tools, also check that a local interpreter satisfies the version range in **Environment**. Bash and PowerShell must be available on the system path (`bash` or `pwsh`).

## Upgrade, uninstall or delete

| Operation | Effect |
| --- | --- |
| Import a higher version with the same ID | Review and confirm the upgrade. Settings and persistent data are retained. Changes to the runtime or dependencies can require installation again. The same or a lower version is rejected. |
| Uninstall | Removes the installed environment. Scripts, settings and persistent data remain available for a later installation. |
| Delete | Removes the tool, its scripts and environment. **Tool settings** is selected for deletion by default; uncheck it to restore those settings on a later import. Optionally select **Run data** (sessions, history and caches) and **Run logs for this tool** to delete them too. Unchecked items are retained; files saved to user-selected locations are unaffected. |

## Find outputs and logs

The **Application data directory** contains `tools/<id>/` for installed tool files, `data/<id>/` for persistent script data and `logs/` for run records. Changing this setting switches libraries; existing files stay in the old directory. To return to the previous library, select its directory again.

Find generated files at the destination chosen for the action. Each run also has a temporary directory that ToolDeck cleans up when the run ends. **Clear run logs** removes saved run records and keeps generated files.
