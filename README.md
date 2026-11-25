# SMR-ONE | Sempu Mulia Residence

Fondasi sistem administrasi iuran bulanan dengan portal admin dan warga.

## Status
Tahap awal: homepage animatif dan kerangka portal. Data pada kartu homepage adalah ilustrasi, belum berasal dari database. Form login belum aktif.

## Rencana arsitektur
- Frontend: HTML, CSS, JavaScript.
- Backend: Google Apps Script Web App.
- Database: Google Sheets.
- WhatsApp: gateway API, misalnya Fonnte, dipanggil dari Apps Script.
- GitHub: version control dan source code.

GitHub Pages dapat menayangkan homepage statis. Integrasi Google Sheets dan notifikasi memerlukan deployment Apps Script sebagai backend. Jangan menaruh token WhatsApp atau kredensial privat di frontend/repository.

## Rencana sheet
| Sheet | Kolom utama |
|---|---|
| Warga | resident_id, kavling, nama, nomor_hp, email, status |
| Akun | user_id, resident_id, role, password_hash, status |
| Tagihan | invoice_id, resident_id, kategori_id, periode, nominal, jatuh_tempo, status |
| Pembayaran | payment_id, invoice_id, tanggal, nominal, metode, bukti_url, verifikator |
| Pengeluaran | expense_id, tanggal, kategori, uraian, nominal |
| Kategori | kategori_id, nama, nominal_default, aktif |
| Pengaturan | key, value |
| Log_WhatsApp | log_id, resident_id, nomor_tujuan, pesan, status, provider_id, waktu |

## Aturan keuangan dan data
1. Setiap tagihan memiliki ID unik dan periode.
2. Pembayaran dicatat sebagai transaksi terpisah.
3. Status tagihan dihitung dari pembayaran terverifikasi dibanding nominal tagihan.
4. Saldo kewajiban warga dipisahkan dari saldo kas perumahan.
5. Tagihan mendatang bukan tunggakan.
6. Perubahan penting dicatat dalam audit log.
7. Warga hanya dapat mengakses data resident_id miliknya; validasi dilakukan di server, bukan hanya browser.

## Keamanan sebelum produksi
- Autentikasi dan sesi diverifikasi di server.
- Jangan menyimpan password plaintext.
- Admin dan warga memiliki otorisasi berbeda.
- Spreadsheet tidak boleh dibagikan publik.
- Simpan token gateway di Apps Script Properties.
- Validasi seluruh input dan gunakan LockService untuk operasi tulis.
- Catat dan batasi percobaan login serta notifikasi.

## Pengembangan lokal
Jalankan `python -m http.server 8000` lalu buka `http://localhost:8000`.

## Tahap berikutnya
1. Code.gs dan appsscript.json.
2. Setup spreadsheet dan header sheet.
3. Autentikasi/otorisasi.
4. CRUD warga, kategori, tagihan, pembayaran.
5. Dashboard dari data nyata.
6. Integrasi WhatsApp dan log pengiriman.


## Homepage background
Foto satelit kawasan Sempu Mulia Residence disimpan lokal di `assets/images/smr-one-residence.webp` dan digunakan sebagai background hero dengan gradient overlay agar teks tetap terbaca. Tidak bergantung pada URL gambar eksternal.
