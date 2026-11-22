# File Pilot — C3 Component Diagram

The following views show direct component dependencies within the same plugin.

## File Management and Settings

```mermaid
flowchart TD
    View["FilePilotView"] -->|"Display data"| Main["FilePilotPlugin"]
    Settings["FilePilotSettingTab"] -->|"Save settings"| State["PluginStateService"]
    Settings -->|"Edit rules"| IgnoreSection["IgnoreRulesSettingSection"]
    IgnoreSection -->|"Read rules"| State

    Main -->|"Read and save data"| State
    Main -->|"Run sync"| Sync["FileSyncService"]
    Main -->|"Execute file actions"| Action["FileActionService"]
    Sync -->|"Scan"| Scanner["FileScanner"]
    Sync -->|"Import"| Import["file-import"]
    Import -->|"Create notes"| Shadow["ShadowNoteService"]
```

## Shadow Notes and Portal Note

```mermaid
flowchart TD
    Main["FilePilotPlugin"] -->|"Subscribe to Summary changes"| Watcher["ShadowNoteWatcher"]
    Main -->|"Manage Portal Note and annotations"| Portal["PortalNoteService"]
    Main -->|"Read summaries and clear notes"| Shadow["ShadowNoteService"]
    View["FilePilotView"] -->|"Watch Summary changes"| Watcher
    View -->|"Read and edit summaries"| Shadow
    View -->|"Update tree after scan"| Portal
    Settings["FilePilotSettingTab"] -->|"Handle project name changes"| Portal

    Watcher -->|"Read and remove records"| State["PluginStateService"]
    Portal -->|"Read records and settings"| State
    Portal -->|"Format references"| Reference["FileReferenceService"]
    Portal -->|"Read summaries"| Shadow
    Portal -->|"Build and render tree"| PortalTree["PortalTreeUtils"]
    Portal -->|"Update Markdown"| ShadowUtils["ShadowNoteUtils"]
    Shadow -->|"Extract and update Summary"| ShadowUtils
    ShadowUtils -->|"Format tree annotations"| PortalTree
```

## File Graph

```mermaid
flowchart TD
    Main["FilePilotPlugin"] -->|"Initialize graph service"| Graph["FileGraphService"]
    View["FilePilotView"] -->|"Build shared tree and update Portal Note"| Portal["PortalNoteService"]
    View -->|"Synchronize graph links"| Graph
    View -->|"Show graph feedback"| GraphUtils["FileGraphUtils"]

    Portal -->|"Build PortalTreeNode"| PortalTree["PortalTreeUtils"]
    Graph -->|"Read settings and clearing state"| State["PluginStateService"]
    Graph -->|"Collect parent-child relationships"| GraphUtils
    Graph -->|"Use PortalTreeNode"| PortalTree
    GraphUtils -->|"Traverse PortalTreeNode"| PortalTree
```

## File References

```mermaid
flowchart TD
    Main["FilePilotPlugin"] -->|"Rebuild index"| Reference["FileReferenceService"]
    Main -->|"Render references"| ReadingRenderer["FileReferenceReadingRenderer"]
    Main -->|"Register editor extension"| EditorExtension["FileReferenceEditorExtension"]
    Main -->|"Register suggestions"| Suggest["FileReferenceSuggest"]

    ReadingRenderer -->|"Resolve references"| Reference
    EditorExtension -->|"Resolve references"| Reference
    Suggest -->|"Format references"| Reference

    ReadingRenderer -->|"Find references"| ReferenceUtils["FileReferenceUtils"]
    EditorExtension -->|"Find references"| ReferenceUtils
    Suggest -->|"Detect completed references"| ReferenceUtils
    Reference -->|"Parse references"| ReferenceUtils

    ReadingRenderer -->|"Create interactive element"| ReferenceElement["FileReferenceElement"]
    EditorExtension -->|"Create interactive element"| ReferenceElement
    ReferenceElement -->|"Resolve current record"| Reference

    ReadingRenderer -->|"Get display data"| ReferenceDisplay["FileReferenceDisplay"]
    EditorExtension -->|"Get display data"| ReferenceDisplay
```
