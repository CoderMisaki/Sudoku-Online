import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Palet warna monokrom mewah
        'background-dark': '#0F0F0F', // Sangat gelap, mendekati hitam, untuk latar belakang utama
        'surface-dark': '#1C1C1C',    // Sedikit lebih terang dari background, untuk kartu atau panel
        'surface-medium': '#2B2B2B',  // Abu-abu gelap menengah, untuk elemen interaktif atau pemisah
        'surface-light': '#444444',   // Abu-abu lebih terang, untuk border atau detail halus
        'text-primary': '#E0E0E0',    // Putih pucat, untuk teks utama agar mudah dibaca
        'text-secondary': '#A0A0A0',  // Abu-abu terang, untuk teks sekunder atau placeholder
        'accent-primary': '#C0C0C0',  // Abu-abu keperakan, untuk highlight penting atau status aktif
        'accent-secondary': '#787878', // Abu-abu menengah, untuk aksen yang kurang menonjol
        'error-red': '#B00020',       // Merah gelap, desaturasi rendah, untuk indikasi error
        'success-green': '#008000',   // Hijau gelap, desaturasi rendah, untuk indikasi sukses
        'warning-yellow': '#F2B705',  // Kuning gelap, untuk peringatan
      },
      // Anda bisa menambahkan font-family, spacing, dll. di sini jika diperlukan
      // Contoh:
      // fontFamily: {
      //   sans: ['Inter', 'sans-serif'],
      // },
    },
  },
  plugins: [],
};
export default config;

