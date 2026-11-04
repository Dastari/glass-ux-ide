import { defineMessagePack, defineMessages, plural, type MessageOverrides, type MessagePack } from "glass-ux/i18n"

/** Every word the workbench shows. Override them with `MessagesProvider`, or register a language pack. */
export const workbenchMessages = defineMessages("ideWorkbench", {
  file: "File",
  edit: "Edit",
  view: "View",
  help: "Help",
  windowMenu: "Window",
  menus: "Application",
  navigation: "Workbench views",
  openFile: "Open…",
  save: "Save",
  saveAs: "Save as…",
  saveAll: "Save all",
  closeEditor: "Close editor",
  undo: "Undo",
  redo: "Redo",
  find: "Find",
  commandPalette: "Commands…",
  quickOpen: "Go to file…",
  togglePanels: "Toggle panels",
  shortcuts: "Keyboard shortcuts",
  appearance: "Appearance",
  files: "Files",
  filesNoun: "files",
  filterFiles: "Filter files",
  explorer: "Explorer",
  openEditors: "Open editors",
  search: "Search",
  searchInFiles: "Search in files",
  searchResults: ({ count, files, locale }: { count: number; files: number; locale: string }) => plural(locale, count, { one: `${count} result in ${files} files`, other: `${count} results in ${files} files` }),
  changes: "Changes",
  noChanges: "No unsaved changes",
  unsaved: "Unsaved",
  compareWithSaved: "Compare with saved",
  changesTo: ({ name }: { name: string }) => `${name} (changes)`,
  tooLargeToCompare: "This file is too large to compare here.",
  refresh: "Refresh",
  collapseFolders: "Collapse folders",
  copyPath: "Copy path",
  openInWindow: "Open in new window",
  moveToTab: "Move to a tab",
  path: "File path",
  untitledName: "untitled.txt",
  go: "Go",
  format: "Format document",
  tooLargeToFormat: "This file is too large to format here.",
  noFormatter: ({ name }: { name: string }) => `No formatter knows the language of ${name}.`,
  goToDefinition: "Go to definition",
  noDefinition: "No definition found.",
  renameSymbol: "Rename symbol",
  newName: "New name",
  nothingToRename: "There is nothing to rename here.",
  showHover: "Show hover",
  splitEditor: "Split editor",
  inWindow: "This file is in a window.",
  notProvided: "The language service does not offer this.",
  restore: "Restore",
  recoveredEdits: ({ name }: { name: string }) => `Unsaved edits to ${name} were kept from an earlier session.`,
  recoveredStale: ({ name }: { name: string }) => `Unsaved edits to ${name} were kept, but the file has changed since, so they cannot be restored.`,
  timeline: "Timeline",
  timelineEmpty: "Open a file to see its history.",
  timelineOpened: "Opened",
  timelineEdit: "Edit",
  timelineTyping: "Typing",
  timelineDeleting: "Deleting",
  timelineSaved: "Saved",
  timelineCurrent: "Current",
  timelineBranch: "Another branch",
  editor: "Editor",
  problems: "Problems",
  output: "Output",
  noFile: "No file open",
  noProblems: "No problems found",
  noDiagnostics: "No diagnostics provider connected",
  readOnly: "Read only",
  saved: "Saved",
  saveFailed: ({ name, reason }: { name: string; reason: string }) => `${name} was not saved: ${reason}`,
  openFailed: ({ name, reason }: { name: string; reason: string }) => `${name} could not be opened: ${reason}`,
  conflict: ({ name }: { name: string }) => `${name} changed somewhere else. Your edits are safe in this tab.`,
  overwrite: "Overwrite",
  reload: "Discard and reload",
  unsavedTitle: ({ name }: { name: string }) => `Save changes to ${name}?`,
  unsavedBody: "Closing without saving loses these edits.",
  saveAndClose: "Save",
  discard: "Discard",
  cancel: "Cancel",
  matchCase: "Match case",
  matchWord: "Match whole word",
  useRegex: "Regular expression",
  badPattern: "That pattern is not valid.",
  suggestions: "Suggestions",
  line: ({ line, column, exact }: { line: string; column: string; exact: boolean }) => `${exact ? "" : "≈"}Ln ${line}, Col ${column}`,
  carets: ({ count }: { count: string }) => `${count} carets`,
  errors: ({ count, locale }: { count: number; locale: string }) => plural(locale, count, { one: `${count} error`, other: `${count} errors` }),
  warnings: ({ count, locale }: { count: number; locale: string }) => plural(locale, count, { one: `${count} warning`, other: `${count} warnings` }),
  opened: ({ name, ms }: { name: string; ms: string }) => `Opened ${name} in ${ms} ms`,
  wroteFile: ({ name }: { name: string }) => `Saved ${name}`,
  newFile: "New file",
  newFileName: "Name of the new file",
  rename: "Rename",
  delete: "Delete",
  deleteTitle: ({ name }: { name: string }) => `Delete ${name}?`,
  deleteBody: "This cannot be undone.",
})

/** Every word of the workbench, for checking a language pack against the English. */
export type WorkbenchWords = typeof workbenchMessages.defaults

declare module "glass-ux/i18n/catalog" {
  interface MessageCatalog {
    ideWorkbench: WorkbenchWords
  }
}

/** A language pack of the workbench's words, checked against the English keys. */
export const defineWorkbenchPack = (locale: string, words: WorkbenchWords): MessagePack => defineMessagePack(locale, { ideWorkbench: words })

/**
 * Joins language packs for one language into one. Registering a second pack for a language replaces
 * the first, so register glass-ux's words and these together:
 * `registerMessagePack(combineMessagePacks(glassUxArabic, workbenchArabic))`.
 */
export const combineMessagePacks = (first: MessagePack, ...rest: readonly MessagePack[]): MessagePack =>
  defineMessagePack(first.locale, Object.assign({}, first.messages, ...rest.map((pack) => pack.messages)) as MessageOverrides)
