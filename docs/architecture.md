# File Pilot — C3 Component Diagram

```mermaid
flowchart TD
    View["FilePilotView"] -->|"Requests sync"| Main["FilePilotPlugin"]
    View -->|"Reads state"| State["PluginStateService"]
    Settings["FilePilotSettingTab"] -->|"Accesses plugin"| Main
    Settings -->|"Updates settings"| State
    Main -->|"Delegates sync"| Sync["FileSyncService"]
    Main -->|"Initializes / reads state"| State
    Sync -->|"Scans"| Scanner["FileScanner"]
    Sync -->|"Imports"| Import["importScannedFiles"]
    Import -->|"Creates notes"| Shadow["ShadowNoteService"]
```
