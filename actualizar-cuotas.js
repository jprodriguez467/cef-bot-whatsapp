const admin = require('firebase-admin');
const XLSX = require('xlsx');
const serviceAccount = require('./cef-tel-primario-firebase-adminsdk-fbsvc-1c70a0236f.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Normalizar nombre: sin acentos, sin separadores, ordenado
function normalizar(nombre) {
  return (nombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .toUpperCase()
    .replace(/[;,\(\)\.]/g, ' ')  // reemplazar separadores
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Similitud entre dos nombres (palabras en común / total palabras únicas)
function similitud(a, b) {
  const wa = new Set(normalizar(a).split(' '));
  const wb = new Set(normalizar(b).split(' '));
  let comunes = 0;
  for (const w of wa) if (wb.has(w)) comunes++;
  const total = new Set([...wa, ...wb]).size;
  return total === 0 ? 0 : comunes / total;
}

const MESES = {
  'marzo': '2026-03', 'abril': '2026-04', 'mayo': '2026-05',
  'junio': '2026-06', 'julio': '2026-07', 'agosto': '2026-08',
  'septiembre': '2026-09', 'octubre': '2026-10', 'noviembre': '2026-11',
  'diciembre': '2026-12'
};

// Leer una hoja del Excel y extraer pagos por alumno
function leerHoja(ws, nombreHoja, turno) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];

  // Encontrar la fila de encabezados (la que tiene "Marzo" o "Abril")
  let headerRow = -1;
  let headers = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map(c => String(c).toLowerCase());
    if (r.includes('marzo') || r.includes('abril')) {
      headerRow = i;
      headers = rows[i];
      break;
    }
  }
  if (headerRow < 0) return [];

  const alumnos = [];
  let i = headerRow + 1;

  while (i < rows.length) {
    const row = rows[i];
    const nombreCelda = String(row[0] || '').trim();

    // Saltar filas vacías o de totales
    if (!nombreCelda || nombreCelda === '' ||
        nombreCelda.toLowerCase().includes('total') ||
        nombreCelda.toLowerCase().includes('ingreso')) {
      i++;
      continue;
    }

    // La segunda columna indica el tipo de fila
    const tipo = String(row[1] || '').toLowerCase().trim();

    // Si es una fila de nombre (tipo = 'pago' o vacío con nombre)
    if (tipo === 'pago' || tipo === '') {
      const alumno = { nombre: nombreCelda, turno, hoja: nombreHoja, pagos: {} };

      // Leer montos de esta fila (Pago)
      const montos = {};
      for (let c = 2; c < headers.length; c++) {
        const header = String(headers[c] || '').toLowerCase().trim();
        if (MESES[header] && row[c] && row[c] !== '') {
          montos[header] = parseFloat(row[c]) || 0;
        }
      }

      // Leer forma de pago (siguiente fila con "forma de pago")
      const formas = {};
      if (i + 1 < rows.length && String(rows[i+1][1] || '').toLowerCase().includes('forma')) {
        const fr = rows[i+1];
        for (let c = 2; c < headers.length; c++) {
          const header = String(headers[c] || '').toLowerCase().trim();
          if (MESES[header] && fr[c] && fr[c] !== '') {
            formas[header] = String(fr[c]).trim();
          }
        }
      }

      // Construir pagos por mes
      for (const [mes, monto] of Object.entries(montos)) {
        if (monto > 0) {
          alumno.pagos[MESES[mes]] = {
            pagado: true,
            monto,
            forma: formas[mes] || 'Efectivo',
            mes: mes.charAt(0).toUpperCase() + mes.slice(1)
          };
        }
      }

      if (Object.keys(alumno.pagos).length > 0) {
        alumnos.push(alumno);
      }
    }
    i++;
  }
  return alumnos;
}

async function main() {
  // Cargar todos los alumnos de Firebase
  console.log('📥 Cargando alumnos de Firebase...');
  const snap = await db.collection('alumnos').get();
  const firebase = snap.docs.map(d => ({
    dni: d.id,
    nombre: d.data().nombreCompleto || d.data().nombre || ''
  }));
  console.log(`   ${firebase.length} alumnos en Firebase`);

  // Leer ambos archivos Excel
  const archivos = [
    { path: 'lista de alumnos 2026.xlsx', turno: 'Mañana' },
  ];

  // Detectar archivos disponibles
  const fs = require('fs');
  const excels = [];
  if (fs.existsSync('Ciclolectivo2026TM.xlsx'))
    excels.push({ path: 'Ciclolectivo2026TM.xlsx', turno: 'Mañana' });
  if (fs.existsSync('REINSCRIPCIÓN_2026_Turno_Tarde.xlsx'))
    excels.push({ path: 'REINSCRIPCIÓN_2026_Turno_Tarde.xlsx', turno: 'Tarde' });

  if (excels.length === 0) {
    console.log('❌ No se encontraron los archivos Excel de cuotas.');
    process.exit(1);
  }

  // Extraer todos los alumnos con pagos de los Excel
  let todosExcel = [];
  for (const archivo of excels) {
    const wb = XLSX.readFile(archivo.path);
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const alumnos = leerHoja(ws, sheetName, archivo.turno);
      todosExcel = todosExcel.concat(alumnos);
    }
  }
  console.log(`\n📊 ${todosExcel.length} alumnos con pagos en los Excel`);

  // Emparejar con Firebase
  const emparejados = [];
  const noEncontrados = [];

  for (const alumnoExcel of todosExcel) {
    let mejorMatch = null;
    let mejorScore = 0;

    for (const fb of firebase) {
      const score = similitud(alumnoExcel.nombre, fb.nombre);
      if (score > mejorScore) {
        mejorScore = score;
        mejorMatch = fb;
      }
    }

    if (mejorScore >= 0.6 && mejorMatch) {
      emparejados.push({ ...alumnoExcel, dni: mejorMatch.dni, nombreFirebase: mejorMatch.nombre, score: mejorScore });
    } else {
      noEncontrados.push({ ...alumnoExcel, mejorCandidato: mejorMatch?.nombre || '', score: mejorScore });
    }
  }

  console.log(`✅ Emparejados: ${emparejados.length}`);
  console.log(`⚠️  No encontrados: ${noEncontrados.length}`);

  // Subir pagos a Firebase
  console.log('\n💾 Subiendo pagos a Firebase...');
  let subidos = 0;
  for (const alumno of emparejados) {
    for (const [mesKey, pago] of Object.entries(alumno.pagos)) {
      await db.collection('cuotas').doc(mesKey)
        .collection('alumnos').doc(alumno.dni)
        .set(pago, { merge: true });
    }
    subidos++;
    if (subidos % 20 === 0) console.log(`   ${subidos}/${emparejados.length}...`);
  }
  console.log(`✅ ${subidos} alumnos actualizados en Firebase`);

  // Generar Excel de revisión para los no encontrados
  if (noEncontrados.length > 0) {
    const revRows = noEncontrados.map(a => ({
      'Nombre en Excel': a.nombre,
      'Hoja': a.hoja,
      'Turno': a.turno,
      'Meses con pago': Object.keys(a.pagos).join(', '),
      'Mejor candidato en Firebase': a.mejorCandidato,
      'Similitud': Math.round(a.score * 100) + '%',
      'DNI correcto (completar)': ''
    }));
    const wsRev = XLSX.utils.json_to_sheet(revRows);
    const wbRev = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbRev, wsRev, 'Revisar');
    XLSX.writeFile(wbRev, 'revisar-cuotas.xlsx');
    console.log(`\n📋 Generado revisar-cuotas.xlsx con ${noEncontrados.length} alumnos para revisar`);
  }

  console.log('\n🎉 ¡Listo!');
  process.exit(0);
}

main().catch(console.error);
