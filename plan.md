1. **Perbaiki UI Chat Terlalu Sempit** (Selesai)
   - Sidebar diperlebar dengan `lg:grid-cols-5` dan `lg:col-span-2`.

2. **Perbaiki Bug "ketika mencet angka 3 malah semua angka 3 jadi ketutup warna putih"** (Selesai)
   - Sudah diganti dengan `bg-sky-500/20` di `SudokuBoard.tsx`.

3. **Perbaiki Bug Pemain Lain Tidak Masuk & Board Tidak Muncul (Online Fitur)** (Selesai)
   - Sudah mengimplementasi sync state realtime di host agar client bisa menerima state dan menyamakan grid ketika masuk.

4. **Tambahkan Pre-commit Steps** (Selesai)
   - Menjalankan build, lint, format. Playwright verifikasi sudah berhasil tanpa eror.

5. **Re-Verification Code Review**
   - Akan dilakukan setelah ini.
