# Node.js Example

After importing the example, click **Install** to prepare its Node.js environment. Then set the greeting prefix and uppercase option in **Tool settings** and choose an action:

- **Preview greeting** takes a name and shows the greeting as structured output and a log entry.
- **Greeting on open** automatically logs a greeting when selected, using the `actionOpen` hook in `lifecycle.mjs`. No click on **Run** is needed. It respects the greeting prefix and uppercase settings. Leaving and returning triggers the greeting again; clicking **Run** also prints it through `greet-on-open.mjs`.
- **Save greeting** writes the greeting to a new UTF-8 file. Select a destination in an existing directory. The result includes links to the file and its directory.
- **Show table** lists this guide and the tool directory as clickable rows and shows the guide size in bytes.
- **Inspect a folder** lists its regular files in a dropdown. Changing the folder keeps the previous filename when available or selects the first file. An empty folder hides the dropdown and clears the selection. Run the action to see the selected file's size and link.

Each entry exports its own main(ctx) function. See manifest.yaml for the Node.js version requirement.

Switch between actions or tools, or leave and return to the Actions tab, to try the lifecycle hooks. The example clears that action’s entire output area, then logs the event and action ID.

To try the parameter hook, choose **Preview greeting** or **Save greeting**, edit **Name**, then press Tab. The hook clears the action’s entire output area before displaying the new name. Clearing the name leaves that output area empty. The **Run** button still runs the selected action separately.

Click **Reset** to restore default parameters and clear the output. The `actionReset` hook then logs the event and action ID.
