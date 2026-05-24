require('dotenv').config();
const admin = require('firebase-admin');
const XLSX = require('xlsx');

const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const wb = XLSX.readFile('lista de alumnos 2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws);

async function importar() {
  let ok = 0;
  for (const row of rows) {
    const dni = String(row.dni || '').trim();
    if (!dni) continue;
    await db.collection('alumnos').doc(dni).set({
      dni,
      nombreCompleto: String(row.nombre || '').trim(),
      grado: String(row.grado || '').trim(),
      turno: String(row.turno || '').trim(),
      fechaNacimiento: String(row.fechaNacimiento || '').trim(),
      sexo: String(row.sexo || '').trim(),
    }, { merge: true });
    ok++;
    console.log(`✅ ${ok} - ${row.nombre}`);
  }
  console.log(`\n🎉 Importados ${ok} alumnos`);
  process.exit(0);
}

importar().catch(console.error);