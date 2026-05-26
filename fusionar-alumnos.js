const admin = require('firebase-admin');
const serviceAccount = require('./cef-tel-primario-firebase-adminsdk-fbsvc-1c70a0236f.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function fusionar() {
  const snap = await db.collection('alumnos').get();
  const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('Total en Firebase: ' + todos.length);
  const grupos = {};
  for (const a of todos) {
    const key = (a.nombreCompleto || a.nombre || '').trim().toUpperCase();
    if (!key) continue;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(a);
  }
  let fusionados = 0;
  for (const [nombre, lista] of Object.entries(grupos)) {
    if (lista.length < 2) continue;
    const merged = {};
    for (const reg of lista) { Object.assign(merged, reg); }
    const dniValido = lista.find(r => /^\d{7,8}$/.test(String(r.dni || '')))?.dni || lista.find(r => /^\d{7,8}$/.test(String(r.id)))?.id;
    if (!dniValido) { console.log('Sin DNI: ' + nombre); continue; }
    await db.collection('alumnos').doc(String(dniValido)).set(merged, { merge: true });
    for (const reg of lista) {
      if (String(reg.id) !== String(dniValido)) {
        await db.collection('alumnos').doc(reg.id).delete();
        console.log('Eliminado: ' + nombre + ' id:' + reg.id);
      }
    }
    fusionados++;
    console.log('Fusionado: ' + nombre + ' DNI:' + dniValido);
  }
  const final = await db.collection('alumnos').get();
  console.log('Fusionados: ' + fusionados + ' | Total final: ' + final.size);
  process.exit(0);
}
fusionar().catch(console.error);
