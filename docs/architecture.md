# File Pilot — C3 Component Diagram

```mermaid
flowchart TD
    View["FilePilotView"] -->|"Requests sync"| Main["FilePilotPlugin"]
    View -->|"Reads state"| State["PluginStateService"]
    Settings["FilePilotSettingTab"] -->|"Accesses plugin"| Main
    Settings -->|"Updates settings"| State
    Settings -->|"Selects scan root"| Dialog["native-file-dialog"]
    Settings -->|"Imports / exports rules"| IgnoreDialog["ignore-rules-file-dialog"]
    IgnoreDialog -->|"Opens / saves paths"| Dialog
    Main -->|"Delegates sync"| Sync["FileSyncService"]
    Main -->|"Initializes / reads state"| State
    Sync -->|"Scans"| Scanner["FileScanner"]
    Sync -->|"Imports"| Import["importScannedFiles"]
    Import -->|"Creates notes"| Shadow["ShadowNoteService"]
```
