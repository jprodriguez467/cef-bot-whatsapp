const admin = require('firebase-admin');
const XLSX = require('xlsx');
const serviceAccount = require('./cef-tel-primario-firebase-adminsdk-fbsvc-1c70a0236f.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function exportar() {
  const snap = await db.collection('alumnos').get();
  const rows = snap.docs.map(d => ({
    nombreCompleto: d.data().nombreCompleto || d.data().nombre || '',
    dni: d.id,
    grado: d.data().grado || '',
    turno: d.data().turno || ''
  }));
  rows.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alumnos');
  XLSX.writeFile(wb, 'alumnos-firebase.xlsx');
  console.log('✅ Exportados ' + rows.length + ' alumnos a alumnos-firebase.xlsx');
  process.exit(0);
}
exportar().catch(console.error);