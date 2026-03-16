---
name: add-pkb
description: add a new entry into the user's personal knowledge base (PKB) stored in their Obsidian Vault.  
allowed-tools: Bash(*)
---

# About the Personal Knowledge Base (PKB)
The Personal Knowledge Base (PKB) is a collection of notes and information that the user has accumulated over time. The PKB consists of terminology/definitions, concepts, processes, and other basic information related to the user's job and interests.  These notes are linked when possible to other notes to show connection and attempt to capture flows of information.

The PKB is implemented as a set of files *markdown, images, etc) in the user's Obsidian Vault.

# About the Obsidian Vault
- refer to 'obsidian-dk-vault.md' custom context for details on the user's Obsidian vault.  It contains the location of their PKB-related notes and information.

# Adding to Personal Knowledge Base (PKB)

## Triggering
This skill is triggered when the user asks to add an item to their PKB.  This could be a request to add a new note, update an existing note, or link notes together.  This could be with simple text like "pkb - ", "pkb: ", "add to pkb - ", "add to pkb: ", or more complex instructions like "add a note about X to my PKB" or "update my PKB with information about Y".  Variations are allowed as long as the intent to add to the PKB is clear.

## Actioning:
When the user asks to add an item to the PKB, do the following:
1. Scan existing PKB notes to see if the item already exists.  If it does, add on the new information to the existing note.  If not, create a new note using the concept, process, term, etc as the title of the note.  The title can only include valid characters for file names and should be concise but descriptive.  Keep the title to 35 characters or less.
2. Add the new information to the note in a clear and organized manner.  Use markdown formatting to make the note easy to read and navigate.  
3.  Report a summary of the note creation to the user.  This should include the title of the note, a brief summary of the content added, and any related notes that were linked.  This helps the user understand what was added to their PKB and how it connects to their existing knowledge.
4. Immediately do a git commit and git push to the user's Obsidian vault to ensure the new information is saved and available across their devices.  This also helps maintain a history of changes to the PKB for future reference.
5. Inform the user you are starting a subagent to find related notes in the PKB.  This will help the user understand that you are taking additional steps to integrate the new information into their existing knowledge base.
6. Execute a subagent to determine if the new information in the PKB is related to existing notes.  If found, link it to the new PKB note using Obsidian's linking syntax (e.g., [[Related Note]]).  This helps create a web of knowledge that is easy to explore.  Either use the link in an existing sentence or append to "Related PKBs: [[Related Note 1]], [[Related Note 2]]" at the top of the note.
7. Report back to the user the agent results, including the number of notes linked to the new PKB page and the names of the linked notes.  This helps the user understand how the new information fits into their existing knowledge base.
