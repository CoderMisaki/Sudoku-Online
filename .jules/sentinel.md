# 2024-07-27 - [Sudoku Together] Game Improvements

- Removed the logo above the title on the Home Page.
- Replaced the static Elapsed label with a dynamic real-time `MM:SS` timer that only starts once a player makes a correct move, calculating `Date.now() - room.startedAt`.
- Enforced a -5 penalty on score calculations for wrong answers during classic and race game modes.
- Added live real-time Toast notifications across the whole room (e.g. `<Username>: Jawaban benar ✅`) whenever a player inputs an answer, maintaining transparency across clients.
