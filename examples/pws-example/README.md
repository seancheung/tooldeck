# PowerShell Example

Set the greeting prefix and uppercase option in **Tool settings**, then choose an action:

- **Preview greeting** takes a name and prints the greeting to the run log.
- **Save greeting** writes the greeting to a new UTF-8 file and prints its path. Choose a destination in an existing directory. An existing file is kept and the action reports an error.

Each action runs its own PowerShell script. The scripts read parameters and settings from TOOLDECK_PARAM_* and TOOLDECK_SETTING_* environment variables. See manifest.yaml for the PowerShell version requirement.
