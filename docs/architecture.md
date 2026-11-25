# Arsitektur SMR-ONE

```text
Browser (Homepage / Admin / Warga)
              | HTTPS JSON
              v
Google Apps Script Web App
        |              |
        v              v
Google Sheets     WhatsApp Gateway
        |
        v
Laporan / Ringkasan
```

## Batas kepercayaan
- Browser dianggap tidak tepercaya.
- Role check dan ownership check dilakukan di Apps Script.
- Spreadsheet tidak dibagikan publik.
- API key WhatsApp hanya berada di Script Properties.

## Definisi metrik
- Total tagihan berjalan: invoice aktif pada periode yang dipilih.
- Tunggakan: sisa invoice yang sudah jatuh tempo, dengan label yang tegas.
- Tagihan mendatang: invoice/jadwal di masa depan, bukan tunggakan.
- Saldo kewajiban warga: total sisa tagihan per warga.
- Saldo kas perumahan: pembayaran terverifikasi dikurangi pengeluaran tercatat.

## Siklus notifikasi
1. Trigger terjadwal mencari invoice yang perlu diingatkan.
2. Backend mengelompokkan rincian berdasarkan warga.
3. Buat idempotency key berdasarkan warga, periode, dan jenis reminder.
4. Periksa log untuk mencegah pesan ganda.
5. Kirim melalui gateway.
6. Simpan status dan timestamp.

## Deployment
1. Deploy Apps Script Web App dengan akses sesuai kebijakan autentikasi.
2. Simpan Spreadsheet ID dan token provider di Script Properties.
3. Uji dengan akun dummy dan uji isolasi data antarwarga.
4. Aktifkan notifikasi setelah pengujian dan persetujuan penerima.
