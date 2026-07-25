// =====================================================================
// IMPORTS
// =====================================================================
import { chromium } from 'playwright';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// =====================================================================
// CONFIG
// =====================================================================
const app = express();
const PORT = 2000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sesiones de captura de gráfica, una por usuario.
// { [username]: { imgPath: string|null, capturando: boolean } }
const sesionesCaptura = {};

// Sesiones de consulta de estadísticas, una por nodo.
// Evita que dos peticiones simultáneas para el mismo nodo pisen
// resultados o dupliquen la consulta contra Telecentro.
// { [nodo]: { consultando: boolean } }
const sesionesEstadisticas = {};

// Sesiones de consulta de abonados, una por nodo. La comparten tanto
// la búsqueda filtrada (/abonados/buscar) como el listado completo
// para la planilla (/abonados/nodo/:nodo), porque las dos pegan contra
// la misma colección de Telecentro para el mismo nodo.
// { [nodo]: { consultando: boolean } }
const sesionesAbonados = {};

// =====================================================================
// MIDDLEWARE
// =====================================================================
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

// =====================================================================
// HELPERS — captura de gráfica (Playwright)
// =====================================================================

/**
 * Abre la URL del nodo con Playwright, aplica los filtros según el tipo
 * de nodo (LEGACY o RPHY) y guarda una captura de pantalla en disco.
 *
 * Se separó de la ruta /refrescar para no recrear la función en cada
 * request y para poder testearla/leerla de forma aislada.
 *
 * @param {object} params
 * @param {string} params.url - URL del nodo a capturar.
 * @param {'LEGACY'|'RPHY'} params.nodoType - Tipo de nodo.
 * @param {string} params.frecuencia - Frecuencia a filtrar en la grilla.
 * @param {string} params.username - Usuario que solicita la captura (se usa para nombrar el archivo).
 * @returns {Promise<string|null>} Ruta absoluta del PNG generado, o null si falló.
 */
async function capturarGrafica({ url, nodoType, frecuencia, username }) {
  if (!url || url === 'undefined') {
    console.error('❌ URL no proporcionada');
    return null;
  }

  let browser;

  try {
    console.log(`📸 Captura de ${username} en proceso...`, new Date().toLocaleString());

    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    await page.waitForTimeout(1000);

    // ----------- CONFIG SEGÚN TIPO -----------
    if (nodoType === 'LEGACY') {
      await page.locator('.control-panel').click();
      await page.locator('#mat-checkbox-7').click();
      await page.locator('#mat-checkbox-3').click();

      const input = page.locator('.mat-form-field').nth(1).locator('input');

      await input.fill('');
      await input.type(frecuencia, { delay: 100 });
      await input.press('Enter');
    } else if (nodoType === 'RPHY') {
      const input = page.locator('.mat-form-field').nth(0).locator('input');

      await input.fill('');
      await input.type(frecuencia, { delay: 100 });
      await input.press('Enter');
    } else {
      console.error('❌ Tipo de nodo inválido');
      return null;
    }

    // ----------- SCREENSHOT -----------
    const fileName = `${username}.png`;
    const filePath = path.join(__dirname, fileName);

    await page.screenshot({
      path: filePath,
      fullPage: true,
    });

    console.log('✅ Captura completada:', fileName);

    return filePath;
  } catch (e) {
    console.error('❌ Error capturando:', e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// =====================================================================
// HELPERS — estadísticas / monitoria
// =====================================================================

const TELECENTRO_MONITORING_URL =
  'https://sc.telecentro.net.ar/webs/scripts/grid_controller_monitoreo.php';

/**
 * Arma el request GET contra el endpoint de jqGrid de Telecentro con
 * los `params` ya armados (coll, model, filters, etc.) y devuelve el
 * array de filas (`rows`) ya extraído de la respuesta.
 *
 * Se separó de /estadisticas para que /abonados/* pueda reusar
 * exactamente la misma lógica de headers, cookie y parseo de errores
 * en vez de duplicarla.
 *
 * @param {URLSearchParams} params
 * @returns {Promise<any[]>}
 */
async function consultarTelecentro(params) {
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  /*
   * Si Telecentro exige una sesión iniciada, deberás guardar
   * la cookie del sistema en una variable de entorno.
   *
   * Nunca envíes esta cookie desde React ni la publiques.
   */
  if (process.env.TELECENTRO_COOKIE) {
    headers.Cookie = process.env.TELECENTRO_COOKIE;
  }

  const response = await fetch(`${TELECENTRO_MONITORING_URL}?${params.toString()}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Telecentro respondió ${response.status}: ${responseText.slice(0, 200)}`);
  }

  let telecentroData;

  try {
    telecentroData = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Telecentro no devolvió JSON. Es posible que haya devuelto la pantalla de inicio de sesión: ${responseText.slice(0, 150)}`
    );
  }

  /*
   * jqGrid suele devolver:
   *   { rows: [ { id: "...", cell: ["id", "RE18L", "RE18", 96, 95, ...] } ] }
   * Pero también soportamos objetos con propiedades normales.
   */
  return Array.isArray(telecentroData.rows)
    ? telecentroData.rows
    : Array.isArray(telecentroData)
      ? telecentroData
      : [];
}

// Campos que le pedimos a la API de Telecentro (se envía tal cual en
// la query, no tocar su forma sin confirmar que el endpoint la acepta).
const monitoringModel = [
  // Nodo y CMTS
  { name: '_id', label: 'id', formatter: 'text' },
  { name: 'nodoCmts', label: 'NodoCmts', formatter: 'text' },
  { name: 'nodo', label: 'Nodo', formatter: 'text' },
  { name: 'cmStatus.cmUpPercent', label: 'Up', formatter: 'int' },
  { name: 'cmStatus.cmTot', label: 'Total', formatter: 'int' },
  // SNR
  { name: 'cmSnr.snrDs', label: 'SNR DS', formatter: 'float' },
  { name: 'cmSnr.snrUs', label: 'SNR US', formatter: 'float' },
  // DS
  { name: 'cmFecDs.dsFecPre', label: 'Pre Ds', formatter: 'float' },
  { name: 'cmFecDs.porcCmFecPre', label: 'Porc. Pre Ds', formatter: 'int' },
  { name: 'cmFecDs.dsFecPost', label: 'Post Ds', formatter: 'float' },
  { name: 'cmFecDs.porcCmFecPost', label: 'Porc. Post Ds', formatter: 'int' },
  // US
  { name: 'cmFecUs.usFecPre', label: 'Pre Us', formatter: 'float' },
  { name: 'cmFecUs.porcCmFecPre', label: 'Porc. Pre Us', formatter: 'int' },
  { name: 'cmFecUs.usFecPost', label: 'Post Us', formatter: 'float' },
  { name: 'cmFecUs.porcCmFecPost', label: 'Porc. Post Us', formatter: 'int' },
  // POTENCIA
  { name: 'cmPwr.pwrDs', label: 'Ds', formatter: 'float' },
  { name: 'cmPwr.pwrUs', label: 'Us', formatter: 'float' },
];

/**
 * Mapa local (no se envía a Telecentro) que describe, para cada campo
 * que nos interesa, en qué posición viene dentro de `row.cell` (formato
 * jqGrid) y en qué path viene si en cambio la fila llega como objeto
 * anidado. Reemplaza los dos bloques de mapeo duplicados que había
 * antes (uno por cada formato posible de fila).
 */
const ROW_FIELDS = [
  { key: 'nodeCmts', index: 1, path: 'nodoCmts' },
  { key: 'node', index: 2, path: 'nodo' },
  { key: 'upPercent', index: 3, path: 'cmStatus.cmUpPercent', numeric: true },
  { key: 'total', index: 4, path: 'cmStatus.cmTot', numeric: true },
  { key: 'snrDs', index: 5, path: 'cmSnr.snrDs', numeric: true },
  { key: 'snrUs', index: 6, path: 'cmSnr.snrUs', numeric: true },
  // DS
  { key: 'conteodspre', index: 7, path: 'cmFecDs.dsFecPre', numeric: true },
  { key: 'conteodsprePercent', index: 8, path: 'cmFecDs.porcCmFecPre', numeric: true },
  { key: 'conteodspost', index: 9, path: 'cmFecDs.dsFecPost', numeric: true },
  { key: 'conteodspostPercent', index: 10, path: 'cmFecDs.porcCmFecPost', numeric: true },
  // US
  { key: 'conteouspre', index: 11, path: 'cmFecUs.usFecPre', numeric: true },
  { key: 'conteousprePercent', index: 12, path: 'cmFecUs.porcCmFecPre', numeric: true },
  { key: 'conteouspost', index: 13, path: 'cmFecUs.usFecPost', numeric: true },
  { key: 'conteouspostPercent', index: 14, path: 'cmFecUs.porcCmFecPost', numeric: true },
  // POTENCIA
  { key: 'pwrDs', index: 15, path: 'cmPwr.pwrDs', numeric: true },
  { key: 'pwrUs', index: 16, path: 'cmPwr.pwrUs', numeric: true },
];

/**
 * Busca un valor dentro de un objeto ya sea por la clave "aplanada"
 * ("cmStatus.cmTot") o navegando el objeto anidado ({ cmStatus: { cmTot } }).
 */
const getNestedValue = (object, objectPath) => {
  if (!object) return undefined;

  // Por si el JSON devuelve la propiedad aplanada: { "cmStatus.cmTot": 95 }
  if (object[objectPath] !== undefined) {
    return object[objectPath];
  }

  // Por si devuelve objetos anidados: { cmStatus: { cmTot: 95 } }
  return objectPath.split('.').reduce((current, key) => current?.[key], object);
};

/**
 * Normaliza un valor crudo (string con "%", coma decimal, $numberDecimal
 * de Mongo, etc.) a un número, o null si no se puede convertir.
 */
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object' && value.$numberDecimal !== undefined) {
    return Number(value.$numberDecimal);
  }

  const normalizedValue =
    typeof value === 'string'
      ? value.replace('%', '').replace(',', '.').trim()
      : value;

  const number = Number(normalizedValue);

  return Number.isFinite(number) ? number : null;
};

const round = (value, decimals = 2) => {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
};

/**
 * Calcula promedio/mín/máx de una lista de valores.
 *
 * Se usa tanto si `values` trae un solo elemento (un nodo con un único
 * CMTS) como si trae varios (un nodo repartido en más de un CMTS): en
 * el caso de un solo valor, average = min = max = ese valor, así que no
 * hace falta una rama aparte para "un solo dato" — dejarlo genérico
 * evita duplicar esta lógica si en el futuro un nodo devuelve más de
 * una fila.
 */
const summarizeValues = (values) => {
  const validValues = values.filter(Number.isFinite);

  if (!validValues.length) {
    return { average: null, min: null, max: null };
  }

  const total = validValues.reduce((sum, value) => sum + value, 0);

  return {
    average: round(total / validValues.length),
    min: round(Math.min(...validValues)),
    max: round(Math.max(...validValues)),
  };
};

/**
 * Convierte una fila cruda de Telecentro (formato jqGrid con `cell`, o
 * un objeto con propiedades anidadas) al objeto plano que usa el resto
 * del código, según el mapeo de ROW_FIELDS.
 */
const parseRow = (row) => {
  const isCellArray = Array.isArray(row.cell);
  const parsed = {};

  for (const field of ROW_FIELDS) {
    const rawValue = isCellArray
      ? row.cell[field.index]
      : getNestedValue(row, field.path);

    parsed[field.key] = field.numeric ? toNumber(rawValue) : rawValue;
  }

  return parsed;
};

// =====================================================================
// HELPERS — abonados (grilla por cablemodem, colección cm_cmts)
// =====================================================================

// Igual que monitoringModel: se envía tal cual a Telecentro, no tocar
// su forma sin confirmar que el endpoint la sigue aceptando.
const abonadosModel = [
  { name: '_id', label: 'id', formatter: 'text' },
  { name: 'idequipo', label: 'idequipo', formatter: 'int' },
  { name: 'mac', label: 'Mac', formatter: 'text' },
  { name: 'cmStatus', label: 'Estado', formatter: 'text' },
  { name: 'cmNodo.nodoCmts', label: 'Nodo Cmts', formatter: 'text' },
  { name: 'cmNodo.nodoTxt', label: 'Nodo', formatter: 'text' },
  { name: 'repositorio.modelo', label: 'Modelo', formatter: 'text' },
  { name: 'cmPartialService.ofdma', label: 'OFDMA partial service', formatter: 'text' },
  { name: 'infocliente.cliente_tipo', label: 'Tipo cliente', formatter: 'text' },
  { name: 'infocliente.segmento', label: 'Segmento', formatter: 'text' },
  { name: 'infocliente.segmento_operativo', label: 'Segmento Operativo', formatter: 'text' },
  { name: 'cmStatusDoc.downTimestamp', label: 'Fecha Caida', formatter: 'int' },
  { name: 'infocliente.idcliente', label: 'Cliente', formatter: 'int' },
  { name: 'infocliente.calle', label: 'Calle', formatter: 'text' },
  { name: 'infocliente.nro', label: 'Nro', formatter: 'int' },
  { name: 'infocliente.piso', label: 'Piso', formatter: 'text' },
  { name: 'infocliente.depto', label: 'Depto', formatter: 'text' },
  { name: 'infocliente.dirExtDireccion', label: 'Dirección Ext. Completa', formatter: 'text' },
  { name: 'cmTrafico.kbpsIn', label: 'Tráfico In', formatter: 'int' },
  { name: 'cmTrafico.kbpsOut', label: 'Tráfico Out', formatter: 'int' },
  { name: 'cmIcmp.ploss', label: 'Ploss', formatter: 'int' },
  { name: 'cmIcmp.delay', label: 'Delay', formatter: 'int' },
  { name: 'cmIcmp.jitter', label: 'Jitter', formatter: 'int' },
  { name: 'cmPwr.pwrDs', label: 'Pwr Ds', formatter: 'text' },
  { name: 'cmPwr.pwrUs', label: 'Pwr Us', formatter: 'text' },
  { name: 'cmPwr.pwrUsRxCmts', label: 'Pwr Us RxCmts', formatter: 'text' },
  { name: 'cmSnr.snrDs', label: 'SNR Ds', formatter: 'text' },
  { name: 'cmSnr.snrUs', label: 'SNR Us', formatter: 'text' },
  { name: 'cmFec.dsFecPre', label: 'Ds FecPre', formatter: 'int' },
  { name: 'cmFec.dsFecPost', label: 'Ds FecPost', formatter: 'int' },
  { name: 'cmFec.usFecPre', label: 'Us FecPre', formatter: 'int' },
  { name: 'cmFec.usFecPost', label: 'Us FecPost', formatter: 'int' },
  { name: 'cmPnm.mtr', label: 'MTR', formatter: 'float' },
  { name: 'cmPnm.firma', label: 'Firma', formatter: 'float' },
  { name: 'cmPnm.severidad', label: null, formatter: null },
  { name: 'infocliente.edificio.idedificio', label: 'ID Edificio', formatter: 'int' },
];

const ABONADOS_RED_FILTER = {
  'sisContratistas.red.id': { $in: ['5b71d0f63ee18d3da5315533'] },
};

/**
 * Mapa local (no se envía a Telecentro) con la posición de cada campo
 * dentro de `row.cell`, en el mismo orden que `abonadosModel` (el
 * índice 0 es siempre `_id`). Solo se listan acá los campos que
 * terminamos devolviendo al frontend — el resto de `abonadosModel`
 * (idequipo, mac, segmento, tráfico, ploss/delay/jitter, OFDMA) se le
 * sigue pidiendo a Telecentro porque el frontend ya arma la query así,
 * pero no se incluye en la respuesta final.
 */
const ABONADO_FIELDS = [
  { key: 'idCliente', index: 12, path: 'infocliente.idcliente', numeric: true },
  { key: 'estadoRaw', index: 3, path: 'cmStatus' },
  { key: 'nodoCmts', index: 4, path: 'cmNodo.nodoCmts' },
  { key: 'nodo', index: 5, path: 'cmNodo.nodoTxt' },
  { key: 'modelo', index: 6, path: 'repositorio.modelo' },
  { key: 'tipoCliente', index: 8, path: 'infocliente.cliente_tipo' },
  { key: 'downTimestamp', index: 11, path: 'cmStatusDoc.downTimestamp', numeric: true },
  { key: 'calle', index: 13, path: 'infocliente.calle' },
  { key: 'nro', index: 14, path: 'infocliente.nro', numeric: true },
  { key: 'piso', index: 15, path: 'infocliente.piso' },
  { key: 'depto', index: 16, path: 'infocliente.depto' },
  { key: 'direccionCompleta', index: 17, path: 'infocliente.dirExtDireccion' },
  { key: 'pwrDs', index: 23, path: 'cmPwr.pwrDs', numeric: true },
  { key: 'pwrUs', index: 24, path: 'cmPwr.pwrUs', numeric: true },
  { key: 'pwrUsRxCmts', index: 25, path: 'cmPwr.pwrUsRxCmts', numeric: true },
  { key: 'snrDs', index: 26, path: 'cmSnr.snrDs', numeric: true },
  { key: 'snrUs', index: 27, path: 'cmSnr.snrUs', numeric: true },
  { key: 'dsFecPre', index: 28, path: 'cmFec.dsFecPre', numeric: true },
  { key: 'dsFecPost', index: 29, path: 'cmFec.dsFecPost', numeric: true },
  { key: 'usFecPre', index: 30, path: 'cmFec.usFecPre', numeric: true },
  { key: 'usFecPost', index: 31, path: 'cmFec.usFecPost', numeric: true },
  { key: 'mtr', index: 32, path: 'cmPnm.mtr', numeric: true },
  { key: 'firma', index: 33, path: 'cmPnm.firma', numeric: true },
  { key: 'cmPnmSeveridad', index: 34, path: 'cmPnm.severidad' },
  { key: 'idEdificio', index: 35, path: 'infocliente.edificio.idedificio', numeric: true },
];

/**
 * Traduce el texto crudo de "cmStatus" a "UP"/"DOWN" (lo que espera el
 * frontend). Si el texto no matchea ninguno de los valores conocidos,
 * se apoya en si tiene fecha de caída cargada como respaldo.
 *
 * IMPORTANTE: no verificamos contra un caso real qué strings devuelve
 * Telecentro en "cmStatus" (¿"UP"/"DOWN"? ¿"online"/"offline"?). Fijate
 * el valor real la primera vez que pruebes esta ruta y sumalo a las
 * listas de abajo si no está.
 */
const normalizeEstado = (estadoRaw, downTimestamp) => {
  const value = String(estadoRaw ?? '').trim().toUpperCase();

  if (['UP', 'ONLINE', 'ARRIBA'].includes(value)) return 'UP';
  if (['DOWN', 'OFFLINE', 'CAIDO', 'CAÍDO'].includes(value)) return 'DOWN';

  return downTimestamp ? 'DOWN' : 'UP';
};

/** cmStatusDoc.downTimestamp viene en segundos unix (como created/updated en otras colecciones). */
const formatFechaCaida = (downTimestamp) => {
  if (!downTimestamp) return null;
  return new Date(downTimestamp * 1000).toLocaleString('es-AR');
};

/**
 * Convierte una fila cruda de la colección cm_cmts al objeto Abonado
 * que espera el componente Suscribers en React.
 *
 * Nota sobre "cliente": esta colección de Telecentro NO trae el
 * nombre del abonado, solo `infocliente.idcliente` (un número). Hasta
 * que se cruce con otro sistema (facturación/CRM) que tenga el nombre
 * real, mostramos "Cliente #<id>" como texto de respaldo.
 */
const parseAbonadoRow = (row) => {
  const isCellArray = Array.isArray(row.cell);
  const raw = {};

  for (const field of ABONADO_FIELDS) {
    const rawValue = isCellArray
      ? row.cell[field.index]
      : getNestedValue(row, field.path);

    raw[field.key] = field.numeric ? toNumber(rawValue) : rawValue;
  }

  return {
    idCliente: raw.idCliente !== null ? String(raw.idCliente) : '',
    cliente: raw.idCliente ? `Cliente #${raw.idCliente}` : 'Cliente sin identificar',
    estado: normalizeEstado(raw.estadoRaw, raw.downTimestamp),
    nodoCmts: raw.nodoCmts ?? '-',
    nodo: raw.nodo ?? '-',
    modelo: raw.modelo ?? '-',
    tipoCliente: raw.tipoCliente ?? '-',
    fechaCaida: formatFechaCaida(raw.downTimestamp),
    calle: raw.calle ?? '-',
    nro: raw.nro !== null ? String(raw.nro) : '-',
    piso: raw.piso ?? '',
    depto: raw.depto ?? '',
    direccionCompleta: raw.direccionCompleta ?? '-',
    idEdificio: raw.idEdificio !== null ? String(raw.idEdificio) : '-',
    pwrDs: raw.pwrDs,
    pwrUs: raw.pwrUs,
    pwrUsRxCmts: raw.pwrUsRxCmts,
    snrDs: raw.snrDs,
    snrUs: raw.snrUs,
    dsFecPre: raw.dsFecPre,
    dsFecPost: raw.dsFecPost,
    usFecPre: raw.usFecPre,
    usFecPost: raw.usFecPost,
    mtr: raw.mtr,
    firma: raw.firma,
    cmPnmSeveridad: raw.cmPnmSeveridad !== null && raw.cmPnmSeveridad !== undefined
      ? String(raw.cmPnmSeveridad)
      : null,
  };
};

/**
 * Toma (o crea) la sesión de lock de abonados para un nodo. El caller
 * es responsable de chequear `.consultando` y de liberarlo en el
 * `finally` con `sesion.consultando = false`.
 */
function tomarSesionAbonados(username) {
  if (!sesionesAbonados[username]) {
    sesionesAbonados[username] = { consultando: false };
  }
  return sesionesAbonados[username];
}

/**
 * Arma la query de jqGrid contra `cm_cmts` con las `rules` de filtro
 * ya armadas por el caller, y devuelve la lista ya parseada a Abonado[].
 *
 * @param {object[]} rules - Reglas de jqGrid (groupOp siempre "AND").
 * @param {number} rows - Máximo de filas a pedir.
 */
async function buscarAbonadosEnTelecentro(rules, rows) {
  const params = new URLSearchParams({
    coll: 'cm_cmts',
    model: JSON.stringify(abonadosModel),
    defaultFilter: JSON.stringify(ABONADOS_RED_FILTER),
    oper: 'grid',
    _search: 'true',
    nd: String(Date.now()),
    rows: String(rows),
    page: '1',
    sidx: '_id',
    sord: 'asc',
    filters: JSON.stringify({ groupOp: 'AND', rules }),
  });

  const rawRows = await consultarTelecentro(params);

  return rawRows.map(parseAbonadoRow);
}

// =====================================================================
// RUTAS
// =====================================================================

// Health check
app.get('/', (req, res) => {
  res.send('OK');
});

// Servir imagen de la última captura de un usuario
app.get('/grafica/:user', (req, res) => {
  const { user } = req.params;
  const sesion = sesionesCaptura[user];

  if (!sesion?.imgPath) {
    return res.status(404).json({ error: 'Sin imagen' });
  }

  res.sendFile(sesion.imgPath);
});

// Refrescar gráfica (dispara una captura con Playwright)
app.post('/refrescar', async (req, res) => {
  const { URL, nodoType, frecuencia, username } = req.body;

  console.log('-------------------------------');
  console.log('🔄 Solicitud de refresco recibida por:', username);

  // Inicializar sesión si no existe
  if (!sesionesCaptura[username]) {
    sesionesCaptura[username] = {
      imgPath: null,
      capturando: false,
    };
  }

  const sesion = sesionesCaptura[username];

  if (sesion.capturando) {
    return res.status(429).json({ msg: 'Captura en progreso' });
  }

  sesion.capturando = true;

  try {
    sesion.imgPath = await capturarGrafica({
      url: URL,
      nodoType,
      frecuencia,
      username,
    });

    if (sesion.imgPath) {
      res.status(200).json(sesion.imgPath);
    } else {
      res.status(400).json({ error: 'No se pudo capturar' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    sesion.capturando = false;
  }
});

// Consultar estadísticas / monitoria de un nodo
app.post('/estadisticas', async (req, res) => {
  const nodo = String(req.body.nodo || '').trim().toUpperCase();

  // Nota: "req.user" no existe porque no hay middleware de auth que lo
  // setee, así que esto siempre cae en 'usuario desconocido'. Se deja
  // documentado por si en algún momento se agrega autenticación.
  const username = req.body.username || 'usuario desconocido';

  console.log('-------------------------------');
  console.log("🔄 Consulta de monitoria en", nodo, "por:", username);

  if (!nodo) {
    return res.status(400).json({ error: 'Debe indicar un nodo' });
  }

  // ---- Sesión por nodo -------------------------------------------------
  // Si dos peticiones llegan al mismo tiempo para el mismo nodo, la
  // segunda espera en vez de disparar otra consulta en paralelo contra
  // Telecentro (mismo criterio que la sesión de /refrescar).
  if (!sesionesEstadisticas[username]) {
    sesionesEstadisticas[username] = { consultando: false };
  }

  const sesion = sesionesEstadisticas[username];

  if (sesion.consultando) {
    return res.status(429).json({
      error: `Ya tenés una consulta en curso, esperá unos segundos`,
    });
  }

  sesion.consultando = true;

  try {
    console.log(`📊 Consulta de monitoria para el ${nodo} en proceso...`, new Date().toLocaleString());
    const filters = {
      groupOp: 'AND',
      rules: [
        {
          field: 'nodoCmts',
          op: 'bw',
          data: nodo,
        },
      ],
    };

    const defaultFilter = {
      'sisContratistas.red.id': { $in: ['5b71d0f63ee18d3da5315533'] },
    };

    const params = new URLSearchParams({
      coll: 'statsNodosCmts',
      model: JSON.stringify(monitoringModel),
      defaultFilter: JSON.stringify(defaultFilter),
      oper: 'grid',
      _search: 'true',
      nd: String(Date.now()),
      rows: '100',
      page: '1',
      sidx: '_id',
      sord: 'asc',
      filters: JSON.stringify(filters),
    });

    const rows = await consultarTelecentro(params);

    if (!rows.length) {
      return res.status(404).json({
        error: `❌ No se encontraron estadísticas para el nodo ${nodo}`,
      });
    } else {
      console.log(`✅ Se encontraron ${rows.length} filas de estadísticas para el nodo ${nodo}`);
    }

    const parsedRows = rows.map(parseRow);

    const total = parsedRows.reduce((sum, row) => sum + (row.total || 0), 0);

    /*
     * La API entrega cantidad total y porcentaje UP.
     * Calculamos la cantidad UP de cada fila y luego las sumamos.
     */
    const calculatedUp = parsedRows.reduce((sum, row) => {
      if (!Number.isFinite(row.total) || !Number.isFinite(row.upPercent)) {
        return sum;
      }

      return sum + row.total * (row.upPercent / 100);
    }, 0);

    const up = Math.min(Math.round(calculatedUp), total);
    const down = Math.max(total - up, 0);

    const upPercent = total > 0 ? round((up / total) * 100) : 0;
    const downPercent = total > 0 ? round((down / total) * 100) : 0;

    const statistics = {
      node: nodo,
      total,
      up,
      down,
      upPercent,
      downPercent,
      snrDs: summarizeValues(parsedRows.map((row) => row.snrDs)),
      snrUs: summarizeValues(parsedRows.map((row) => row.snrUs)),
      // DS
      dsFecPre: summarizeValues(parsedRows.map((row) => row.conteodspre)),
      dsFecPrePercent: summarizeValues(parsedRows.map((row) => row.conteodsprePercent)),
      dsFecPost: summarizeValues(parsedRows.map((row) => row.conteodspost)),
      dsFecPostPercent: summarizeValues(parsedRows.map((row) => row.conteodspostPercent)),
      // US
      usFecPre: summarizeValues(parsedRows.map((row) => row.conteouspre)),
      usFecPrePercent: summarizeValues(parsedRows.map((row) => row.conteousprePercent)),
      usFecPost: summarizeValues(parsedRows.map((row) => row.conteouspost)),
      usFecPostPercent: summarizeValues(parsedRows.map((row) => row.conteouspostPercent)),
      // POTENCIA
      pwrDs: summarizeValues(parsedRows.map((row) => row.pwrDs)),
      pwrUs: summarizeValues(parsedRows.map((row) => row.pwrUs)),
    };

    return res.status(200).json(statistics);
  } catch (error) {
    console.error('❌ Error consultando monitoria:', error);

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido al consultar monitoria',
    });
  } finally {
    sesion.consultando = false;
  }
});

// Buscar abonados de un nodo aplicando los filtros que estén cargados
// (todos combinados con AND). Usada por el buscador del componente
// Suscribers en React.
app.post('/abonados/nodo', async (req, res) => {
  const nodo = String(req.body.nodo || '').trim().toUpperCase();
  const username = req.body.username || 'usuario desconocido';

  console.log('-------------------------------');
  console.log("🔄 Consulta de abonados en", nodo, "por:", username);

  if (!nodo) {
    return res.status(400).json({ error: 'Debe indicar un nodo' });
  }

  // ---- Sesión por usuario (antes era por nodo) ----
  const sesion = tomarSesionAbonados(username);

  if (sesion.consultando) {
    return res.status(429).json({
      error: `Ya tenés una consulta de abonados en curso, esperá unos segundos`,
    });
  }

  sesion.consultando = true;

  try {
    console.log(`📊 Consulta de abonados para el ${nodo} en proceso...`, new Date().toLocaleString());
    const rules = [{ field: 'cmNodo.nodoCmts', op: 'bw', data: nodo }];

    const abonados = await buscarAbonadosEnTelecentro(rules, 200);

    if (!abonados.length) {
      return res.status(404).json({
        error: `❌ No se encontraron abonados para el nodo ${nodo}`,
      });
    } else {
      console.log(`✅ Se encontraron ${abonados.length} abonados para el nodo ${nodo}`);
    }

    return res.status(200).json(abonados);
  } catch (error) {
    console.error('❌ Error buscando abonados:', error);

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido buscando abonados',
    });
  } finally {
    sesion.consultando = false;
  }
});
// =====================================================================
// INIT / SERVER
// =====================================================================
(async () => {
  console.log('🚀 Inicializando...');
})();

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});