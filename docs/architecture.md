# File Pilot — C3 Component Diagram

```mermaid
flowchart TD
    View["FilePilotView"] -->|"display data"| Main["FilePilotPlugin"]
    View -->|"watch data"| Watcher["ShadowNoteWatcher"]
    Watcher -->|"Remove records"| State
    Settings["FilePilotSettingTab"] -->|"Save settings"| State["PluginStateService"]
    Settings -->|"Edit rules"| IgnoreSection["IgnoreRulesSettingSection"]
    IgnoreSection -->|"Read rules"| State
    Main -->|"Read and save data"| State
    Main -->|"Run sync"| Sync["FileSyncService"]
    Sync -->|"Scan"| Scanner["FileScanner"]
    Sync -->|"Import"| Import["file-import"]
    Import -->|"Create notes"| Shadow["ShadowNoteService"]
```
