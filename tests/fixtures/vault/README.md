# Fixture vault

A fake Obsidian vault. Every entry, goal and moment in here is invented for the
tests — none of it is anyone's real journal.

The tests read this directory and nothing else. A test that needs a real vault
is a wrong test: it would either leak private content into the repo or fail on
any machine but one.
