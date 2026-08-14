Sudoku Online

«A real-time multiplayer Sudoku experience built for collaboration, competition, and fast-paced gameplay.»

Sudoku Online adalah aplikasi Sudoku multiplayer berbasis web yang memungkinkan beberapa pemain bermain dalam satu room realtime. Pemain dapat bekerja sama menyelesaikan puzzle, bersaing berdasarkan progress atau skor, bermain dengan aturan klasik, mengejar combo dalam mode Race, atau menikmati pengalaman santai melalui mode Zen.

Project ini dibangun menggunakan Next.js, React, TypeScript, Zustand, Supabase Realtime, dan Tailwind CSS, dengan fokus pada pengalaman multiplayer yang responsif, sinkronisasi realtime, keamanan validasi jawaban, serta UX yang modern.

---

✨ Highlights

- 🎮 5 Game Modes
- 👥 Multiplayer Realtime
- 🏠 Room-based Gameplay
- 🔄 Automatic Host Migration
- 👀 Spectator Mode
- ⚡ Optimistic UI Updates
- 💬 Realtime Chat
- ✏️ Pencil / Notes Mode
- 🧹 Eraser Mode
- 💡 Hints
- 🏆 Score, Progress & Ranking System
- 🔐 Server-side Answer Verification
- 🛡️ Move Rate Limiting
- 🎯 5 Difficulty Levels
- 🔁 Next Game Customization
- 💾 Persistent Client State

---

🎮 Game Modes

Sudoku Online memiliki beberapa mode dengan karakter gameplay yang berbeda.

Mode| Fokus| Deskripsi
Collaborative| 🤝 Kerja sama| Semua pemain bekerja bersama pada puzzle yang sama secara realtime.
Competition| 🏆 Persaingan| Setiap pemain mendapatkan puzzle individual dan bersaing berdasarkan progress serta ranking.
Classic| 🧩 Sudoku klasik| Pengalaman Sudoku multiplayer dengan mekanisme permainan klasik.
Race| ⚡ Kecepatan| Fokus pada kecepatan, combo, streak, dan perolehan skor.
Zen| 🌿 Santai| Gameplay tanpa tekanan skor dan penalti yang agresif.

Collaborative

Mode untuk bermain bersama.

Semua pemain berinteraksi dengan puzzle yang sama sehingga setiap perubahan pada board dapat disinkronkan ke pemain lain secara realtime.

Cocok untuk:

- Bermain bersama teman
- Memecahkan puzzle secara teamwork
- Belajar strategi Sudoku bersama
- Casual multiplayer

Competition

Mode kompetitif dengan puzzle individual untuk setiap pemain.

Pemain dapat melihat:

- Progress pemain lain
- Ranking
- Status permainan

Setiap pemain menyelesaikan puzzle masing-masing sehingga kemenangan ditentukan oleh performa individual.

Classic

Mode dengan gameplay Sudoku yang lebih tradisional.

Kesalahan input diperlakukan secara ketat dan sistem tetap memberikan validasi terhadap jawaban pemain.

Race

Mode yang dirancang untuk permainan cepat.

Race menggunakan:

- Combo
- Streak
- Score multiplier
- Time-based scoring
- Wrong-move punishment
- Temporary stun / lockout

Correct move yang dilakukan dalam waktu cepat dapat meningkatkan combo. Kesalahan dapat menyebabkan pemain terkena 3-second stun, dengan board mengalami efek visual grayscale selama periode tersebut.

Zen

Mode untuk pemain yang ingin bermain tanpa tekanan kompetitif.

Zen menghilangkan:

- Tekanan score
- Penalti wrong move
- Batasan hint yang agresif

Mode ini juga menyediakan Auto-Note, yang membantu memasukkan kandidat angka yang valid ke cell kosong.

---

🧩 Difficulty

Puzzle dapat dimainkan dalam lima tingkat kesulitan:

1. Easy
2. Medium
3. Hard
4. Expert
5. Evil

Host dapat menentukan difficulty ketika membuat room dan juga dapat mengubah difficulty ketika memulai game berikutnya.

---

👥 Multiplayer & Rooms

Game menggunakan sistem room-based multiplayer.

Host dapat membuat room dengan konfigurasi:

- Difficulty
- Game Mode
- Maximum Players

Maximum active players yang tersedia:

- 2 Players
- 4 Players
- 6 Players
- 8 Players

Pemain lain dapat bergabung menggunakan Room Code.

Room memiliki lifecycle:

Waiting
   ↓
Playing
   ↓
Completed

Setiap room menyimpan informasi seperti:

- Room ID
- Room Code
- Host ID
- Difficulty
- Game Mode
- Maximum Players
- Player List
- Room Status
- Creation Time
- Start Time
- Completion Time

---

⚡ Real-Time Multiplayer

Sinkronisasi multiplayer menggunakan Supabase Realtime.

Berbagai aktivitas dapat dikirimkan antar-player melalui realtime channel, termasuk:

- Player movement
- Cell updates
- Cursor position
- Cell locks
- Pencil notes
- Player progress
- Chat messages
- Game state
- Next Game events
- Player presence

Dengan pendekatan ini, perubahan yang dilakukan satu pemain dapat segera terlihat oleh pemain lainnya.

---

🚀 Optimistic UI

Responsiveness menjadi salah satu bagian penting dari gameplay.

Ketika pemain memasukkan angka, aplikasi tidak harus menunggu server selesai melakukan validasi sebelum memperbarui tampilan lokal.

Alurnya:

Player Input
     │
     ▼
Optimistic UI Update
     │
     ├──────────────► Realtime Broadcast
     │
     ▼
Server Verification
     │
     ▼
Verification Result
     │
     ▼
Final Game State

Move dapat ditampilkan secara langsung pada client, sementara proses validasi server berjalan secara asynchronous.

Hal ini mengurangi persepsi latency ketika bermain multiplayer.

---

🔐 Security & Server Validation

Game tidak mengandalkan client sebagai sumber kebenaran utama untuk validasi jawaban.

Ketika puzzle dibuat, server menghasilkan:

Initial Grid
+
Solution Grid

Solution kemudian dienkripsi menjadi:

solutionToken

Token tersebut digunakan oleh endpoint server untuk melakukan validasi.

Contoh alur:

Create Puzzle
     │
     ▼
Generate Solution
     │
     ▼
Encrypt Solution
     │
     ▼
solutionToken
     │
     ▼
Player submits answer
     │
     ▼
Server decrypts solution
     │
     ▼
Compare answer
     │
     ▼
isCorrect

Endpoint game juga melakukan validasi terhadap payload dan menolak token yang tidak valid.

Project juga memiliki mekanisme action rate limiting untuk membatasi input yang terlalu cepat dan membantu mengurangi abuse terhadap sistem realtime.

«Catatan: keamanan produksi tetap bergantung pada konfigurasi environment, deployment, Supabase policies, dan implementasi backend secara keseluruhan.»

---

👀 Spectator Mode

Jika jumlah pemain aktif telah mencapai batas room, pemain tambahan dapat masuk sebagai spectator.

Spectator dapat mengikuti permainan tanpa mengambil slot pemain aktif.

Dalam spectator mode:

- Input board dinonaktifkan
- Event gameplay tertentu tidak diproses sebagai player action
- UI menampilkan status spectator
- Spectator tetap dapat mengikuti aktivitas room

Hal ini memungkinkan room tetap dapat ditonton meskipun jumlah pemain aktif sudah penuh.

---

👑 Host Migration

Room tidak bergantung sepenuhnya pada koneksi host saat ini.

Jika host disconnect, sistem memiliki mekanisme Host Migration.

Migration menggunakan grace period sehingga perpindahan host tidak terjadi secara agresif ketika koneksi hanya mengalami gangguan sementara.

Host baru dipilih setelah periode tunggu atau ketika host secara eksplisit meninggalkan room.

---

🔄 Next Game

Setelah satu game selesai, host dapat memulai game berikutnya tanpa harus membuat room baru.

Host dapat memilih:

- Difficulty
- Game Mode
- Maximum Players

Flow:

Game Completed
      │
      ▼
Next Game
      │
      ├── Continue Current Settings
      │
      └── Customize Settings
              │
              ├── Difficulty
              ├── Game Mode
              └── Max Players
      │
      ▼
Generate New Puzzle
      │
      ▼
Broadcast New Game

Progress, score, rank, hints, dan streak pemain di-reset untuk round baru, sementara history chat tetap dipertahankan.

---

✏️ Sudoku Board

Board mendukung beberapa mekanisme interaksi:

Number Input

Pemain dapat memasukkan angka langsung ke cell yang tidak terkunci.

Pencil Mode

Pemain dapat menyimpan kandidat angka sebagai notes.

Sistem membatasi maksimal 5 notes dalam satu cell.

Eraser

Eraser dapat digunakan untuk:

- Menghapus value cell
- Mengubah atau menghapus pencil notes

Cell Lock

Ketika pemain sedang berinteraksi dengan cell tertentu, sistem dapat menggunakan temporary cell lock untuk membantu menghindari konflik input realtime.

Conflict Detection

Board memiliki informasi mengenai:

- Conflicting cells
- Wrong answers
- Locked cells
- Pending optimistic moves

---

💬 Realtime Chat

Setiap room memiliki chat realtime untuk berkomunikasi antar-player.

Chat mendukung:

- Username
- Message
- Timestamp
- Realtime delivery
- Unread notification
- Auto-scrolling

Chat history juga dipertahankan ketika berpindah ke game berikutnya.

---

🏆 Player State

Setiap player memiliki state seperti:

id
username
color
isHost
score
progress
rank
hints
streak
lastCorrectMoveAt
stunnedUntil
status
cursor
isSpectator

Player status dapat berupa:

- "online"
- "offline"
- "disconnected"
- "left"

Status ini memungkinkan UI membedakan kondisi koneksi pemain dengan lebih akurat.

---

🧠 State Management

Client-side game state dikelola menggunakan Zustand.

State utama mencakup:

User
Room
Players
Grid
Solution Token
Messages
Selected Cell
Game State

Zustand juga digunakan untuk mengelola:

- Optimistic moves
- Cell validation
- Player progress
- Ranking
- Notes
- Next game state
- Room state
- Persistent game data

---

🛠️ Tech Stack

Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Framer Motion
- Lucide React

State Management

- Zustand

Backend / Realtime

- Next.js API Routes
- Supabase
- Supabase Realtime

Game Logic

- sudoku-gen

UI & Utilities

- React Hot Toast
- clsx
- tailwind-merge

Dependency configuration project mencantumkan Next.js 16.2.12, React 19.2.4, Supabase JS 2.110.8, Zustand 5.0.14, sudoku-gen 1.0.2, Tailwind CSS 4, dan TypeScript 5.

---

📁 Project Architecture

Secara konseptual, project dibagi menjadi beberapa layer:

app/
├── pages & layouts
├── game routes
└── API routes

components/
├── game
└── UI

hooks/
└── useRealtime

store/
└── gameStore

services/
└── Supabase connection

utils/
├── Sudoku generation
├── Security
└── Shared utilities

types/
└── Game models

Beberapa komponen penting:

SudokuBoard
    │
    ├── Game Store
    │
    ├── Realtime Hook
    │
    └── Server Verification

---

🔌 API Flow

Create Room / Puzzle

Endpoint:

POST /api/game/create-room

Request:

{
  "difficulty": "medium"
}

Response utama:

{
  "initialGrid": [],
  "solutionToken": "..."
}

Puzzle dibuat server-side menggunakan difficulty yang diberikan, kemudian solution dienkripsi menjadi token.

---

Verify Cell

Endpoint:

POST /api/game/verify

Request:

{
  "row": 0,
  "col": 0,
  "value": 5,
  "solutionToken": "..."
}

Server kemudian membandingkan value yang diberikan dengan solution sebenarnya dan mengembalikan:

{
  "isCorrect": true
}

Validasi dilakukan berdasarkan solution yang didekripsi di server.

---

💻 Getting Started

Prerequisites

Pastikan environment telah memiliki:

- Node.js
- npm / yarn / pnpm / bun
- Supabase project

---

Installation

Clone repository:

git clone <repository-url>
cd <project-directory>

Install dependencies:

npm install

atau:

yarn install

pnpm install

bun install

---

⚙️ Environment Variables

Buat file:

.env.local

Kemudian konfigurasi environment yang diperlukan oleh aplikasi.

Contoh:

NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
ROOM_SECRET_KEY=your_secure_room_secret

«Jangan commit ".env.local" atau secret production ke repository. Project juga mengabaikan file ".env*" melalui ".gitignore".»

Gunakan secret yang kuat dan berbeda untuk setiap environment.

---

▶️ Development

Jalankan development server:

npm run dev

Kemudian buka:

http://localhost:3000

Alternatif package manager:

yarn dev

pnpm dev

bun dev

---

🏗️ Production Build

Build project:

npm run build

Jalankan production server:

npm run start

Sebelum deployment, pastikan:

- Environment variables sudah dikonfigurasi
- Supabase URL benar
- Supabase anon key benar
- "ROOM_SECRET_KEY" tersedia di server
- Realtime channel dapat digunakan
- Database / Supabase policies telah dikonfigurasi sesuai kebutuhan

---

🧪 Code Quality

Project menggunakan:

- ESLint
- Next.js ESLint configuration
- TypeScript

Konfigurasi linting menggunakan:

eslint-config-next/core-web-vitals
eslint-config-next/typescript

Jalankan lint:

npm run lint

---

📡 Realtime Event Architecture

Beberapa event realtime yang digunakan dalam gameplay antara lain:

progress_update
cursor
cell_lock
note
move_optimistic
move_verified
next_game

Contoh:

Player A
   │
   │ move
   ▼
Realtime Channel
   │
   ├──────────► Player B
   ├──────────► Player C
   └──────────► Player D

Untuk optimistic gameplay, sistem memisahkan event sementara dengan hasil verifikasi final:

move_optimistic
       ↓
Immediate UI Update
       ↓
Server Verification
       ↓
move_verified
       ↓
Final State

---

🎯 Design Goals

Project ini dirancang dengan beberapa prinsip utama:

1. Responsiveness

Input pemain harus terasa instan meskipun validasi dilakukan melalui server.

2. Multiplayer Synchronization

Semua player harus mendapatkan state room yang konsisten.

3. Gameplay Variety

Setiap mode memiliki mekanisme yang berbeda agar gameplay tidak terasa monoton.

4. Fault Tolerance

Disconnect dan host migration harus dapat ditangani tanpa menghancurkan room.

5. Server-side Validation

Client tidak boleh menjadi satu-satunya sumber kebenaran untuk menentukan jawaban Sudoku.

6. Maintainable Architecture

Game logic, state management, realtime communication, UI, dan API validation dipisahkan agar lebih mudah dikembangkan.

---

🛡️ Security Considerations

Project telah melakukan beberapa hardening terhadap sistem, termasuk:

- Memindahkan pembuatan room dan encryption solution ke server-side API.
- Validasi solution menggunakan encrypted "solutionToken".
- Mengurangi risiko payload spoofing.
- Menghapus fallback credential tertentu dari konfigurasi Supabase.
- Rate limiting untuk input yang terlalu cepat.
- Pemisahan state optimistic dan state hasil verifikasi.

Perubahan tersebut merupakan bagian dari pengembangan keamanan dan stabilitas multiplayer project.

Penting: jangan menganggap mekanisme tersebut sebagai jaminan keamanan absolut. Untuk deployment publik, Supabase RLS/policies, secret management, API abuse protection, validation boundary, dan observability tetap perlu diaudit secara menyeluruh.

---

🔄 Development History

Project telah mengalami beberapa iterasi besar, terutama pada:

- Realtime synchronization
- Multiplayer latency
- Host migration
- Spectator mode
- Competition mode
- Race mode
- Zen mode
- Pencil / Eraser
- Chat
- Optimistic UI
- Server-side verification
- Security hardening
- Next Game customization

Beberapa optimasi realtime secara khusus dibuat untuk mengatasi delay input dan memungkinkan update multiplayer terjadi jauh lebih cepat sebelum server verification selesai.

---

🚧 Current Scope

Project saat ini berfokus pada:

Multiplayer Sudoku
        +
Realtime Synchronization
        +
Multiple Gameplay Modes
        +
Competitive Mechanics
        +
Server Validation
        +
Responsive UX

Beberapa tipe game juga tercatat pada model internal sebagai "learning", tetapi opsi mode yang saat ini ditampilkan pada UI room adalah Collaborative, Competition, Classic, Race, dan Zen.

---

🗺️ Potential Future Improvements

Beberapa pengembangan yang secara natural dapat dilakukan berikutnya:

- 🔐 Authentication & player accounts
- 📊 Player statistics
- 🏆 Global leaderboard
- 🥇 Ranked matchmaking
- 📈 Match history
- 🧠 Advanced Sudoku analytics
- 🎖️ Achievements
- 🎨 More board themes
- 🔊 Sound effects
- 📱 Improved mobile controls
- 🌐 Internationalization
- 🛡️ Advanced anti-cheat
- 📡 Realtime connection diagnostics
- 🧪 Automated multiplayer testing
- 📊 Admin / moderation tools

---

📜 License

Tambahkan lisensi project sesuai kebijakan distribusi yang ingin digunakan.

Contoh:

MIT License

atau gunakan lisensi proprietary jika project tidak dimaksudkan untuk didistribusikan secara bebas.

---

❤️ Project Philosophy

Sudoku tidak harus selalu dimainkan sendirian.

Sudoku Online mengubah puzzle klasik menjadi pengalaman multiplayer yang menggabungkan:

Logic × Competition × Collaboration × Real-Time Interaction

Tujuannya sederhana:

«Make Sudoku feel alive.»
