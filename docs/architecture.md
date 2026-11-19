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
    Main -->|"Execute file actions"| Action["FileActionService"]
    Main -->|"Rebuild reference index"| Reference["FileReferenceService"]
    Portal["PortalNoteService"] -->|"Read records and settings"| State
    Portal -->|"Format file references"| Reference
    Main -->|"Render references"| ReadingRenderer["FileReferenceReadingRenderer"]
    Main -->|"Register editor extension"| EditorExtension["FileReferenceEditorExtension"]
    Main -->|"Register suggestions"| Suggest["FileReferenceSuggest"]
    ReadingRenderer -->|"Resolve references"| Reference
    EditorExtension -->|"Resolve references"| Reference
    Suggest -->|"Format references"| Reference
    ReadingRenderer -->|"Create interactive element"| ReferenceElement["FileReferenceElement"]
    EditorExtension -->|"Create interactive element"| ReferenceElement
    ReferenceElement -->|"Resolve current record"| Reference
    ReadingRenderer -->|"Get display data"| ReferenceDisplay["FileReferenceDisplay"]
    EditorExtension -->|"Get display data"| ReferenceDisplay
    Sync -->|"Scan"| Scanner["FileScanner"]
    Sync -->|"Import"| Import["file-import"]
    Import -->|"Create notes"| Shadow["ShadowNoteService"]
```
