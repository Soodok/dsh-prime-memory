# Registro de cambios (Changelog en español)

- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog en español](./CHANGELOG.es.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog на русском](./CHANGELOG.ru.md)

Este archivo registra los cambios notables de dsh-prime-memory (llamado dsh-memory-plugin antes de 0.5.0). El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y los números de versión obedecen al [versionado semántico](https://semver.org/).

> **Convención de capturas de interfaz**: las entradas que traen cambios de interfaz conservan capturas reales
> en `assets/changelog/<número de versión>/<número de dos dígitos>-<resumen>.png` y las citan en el texto con una ruta relativa: en el registro de cambios se ve directamente cómo luce la interfaz de la nueva versión.

## [0.24.1] — 2026-10-14

### Añadido
- **Invariante de sufijo de la proyección (`convergeDisabledSuffix`)**: `.memory.md` / `.memory.md.disable` depende solo de «si el registro está retirado en la biblioteca», sin relación con `name` ni con la ruta que lo retiró. Se comprueba por entrada: existencia del fichero, sufijo actual, huella coincidente. Un `.disable` hecho a mano es prueba del lado fichero: solo se informa como `both`, no se toca.
- **El gancho biblioteca→fichero se recoge en `L1Store` (`store/memory-md-sync.ts`)**: `setFileSyncHook` se dispara en los cuatro puntos de confluencia (`appendNew` / `retire` / `restore` / `rename`) en lugar de los ocho sitios de llamada; en máquina real 920 retirados tenían solo 8 `.disable`, todos del panel de recall. Los retiros automáticos (fusión, conflicto perdido) y el `memory_add` del modelo se propagan solos.
- **El fichero sigue al renombrado**: tras `rename()` la proyección se muda al nombre nuevo (el hermano `.disable` viaja con él) y se reescribe la clave del libro mayor; si el camino viejo no tenía fichero se escribe el nuevo nombre, y si el destino está ocupado solo se avisa.
- **Ejecución en rollo con barra de progreso (`store/memory-md-run.ts`, nuevo endpoint `dsh-memory/mem-run-status`)**: un clic empuja el cursor de exportación hasta el final de la tabla y luego el de convergencia, con topes entre pasadas `maxPasses` / `totalBudgetMs`; lo que queda se dice en `notice`.
### Cambiado
- **Presupuesto de actualización por clic**: `memExport.maxRecords` de 300 → **2000**, más el mando en caliente `live.mdExportMaxRecords` (0 = sigue el valor desplegado, sin reiniciar). El rótulo engañoso «barandilla de acción única» pasa a **«presupuesto de actualización de ficheros»**, unidad «ficheros/clic», con el valor realmente aplicado `appliedMaxRecords`.
### Corregido
- El presupuesto contaba el recorrido, no las acciones en disco (los «sin cambio» gastaban cuota): 1210 registros exigían cuatro clics.
- Escritura del libro mayor O(n²): un `flush()` por renombrado (el libro es un JSON reescrito entero) → ahora marca sucia en el bucle y un único `flush()` al final.
- Dos disparos consecutivos se pisaban → la proyección se **serializa** en segundo plano; antes la segunda tarea veía «no hay fichero» antes de que la primera lo escribiera y el retirado se quedaba en `.memory.md`.
- Duplicados permanentes tras reactivar → el `.disable` obsoleto solo se borra si se cumplen «misma id en el libro + bytes sin cambiar desde que lo escribimos + el `.memory.md` es justo el render actual».

## [0.24.0] — Sin publicar (línea local `0.24.0-local.0…3`, 2026-10-13)

### Añadido

- **Vocabulario de tipos con fuente única de verdad (`src/memory-types.ts`)**: los 29 nombres originales de la taxonomía de memoria del huésped + los 7 antiguos del plugin + el paraguas `unclassified`, 37 tipos en total. De ella se derivan **todos**: el allowlist del directorio de proyección, el allowlist de escritura de `memory_add`, las etiquetas del panel, las cadenas de enumeración de los prompts de extracción y de deduplicación, y los códigos de tipo de la doble implementación TS/Python de memport. Hasta ahora el «conjunto completo de tipos» estaba transcrito a mano en cuatro sitios que evolucionaban por separado: `memory_add` **reescribía en silencio** las clasificaciones externas a `episodic`, mientras el texto de memport prometía «pasarlas tal cual» — dos criterios para la misma cosa.
- **Destilación de nombres (`cfg.naming`)**: la extracción emite en el acto un `title`, **definido por separado del** `content` (el title es el sintagma nominal que responde «¿de qué trata esta entrada?», el content es la narración completa); el merge de deduplicación emite además `merged_title`. Al persistir, el `title` es solo un **candidato de nombre**: debe superar la puerta de forma `validateTitle`; si no la supera, se entrega igualmente al generador de nombres — la fuente de verdad de la unicidad del nombre no desdobla criterios por admitir una fuente más.
- **Juego de ejemplos few-shot en formato estándar (`src/prompts/examples.ts`)**: positivos por tipo + contraejemplos, con presupuesto máximo de longitud total (los ejemplos son un coste fijo que se paga en cada ronda de destilación); los propios positivos deben superar la puerta y traer el esqueleto completo, y los casos de prueba se alimentan directamente de `auditFewShot()` en lugar de transcribir los criterios a mano.
- **Criterio de esqueleto ejecutable (`SKELETON_ELEMENTS` + `scoreSkeleton`)**: convierte el deseo escrito en el prompt —«sin antecedentes ni consecuencias, si no está completo no vale como utilizable»— en un criterio medible y utilizable para fijar valores por defecto. Limitación declarada: heurística de palabras clave, solo apta para comparación relativa entre dos brazos sobre la misma entrada; no es una puntuación absoluta de calidad.
- **Esqueleto de directorios + `_index.md` por tipo (`memory-md-skeleton.ts`)**: cada directorio de tipo guarda un fichero índice (nombre de la clase + número de entradas en la base). Los directorios vacíos se los tragan git y el archivo comprimido, y a ojos humanos «no existe ese directorio» e «esta clase tiene 0 entradas» tienen el mismo aspecto. Idempotente: si el contenido no cambia, cero escrituras y no se pinta el mtime; con la superficie de proyección cerrada, cero acción.

### Cambiado

- **Tres valores por defecto girados según la medición A/B** (`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). El fundamento son dos mediciones **de direcciones opuestas**: en la ruta real de destilación de conversaciones, sin ejemplos el esqueleto completo queda en **0.000**（0/23）, con ejemplos sube a **0.703**（26/37）; en cambio, a las tareas de renombrar entradas existentes, añadir ejemplos las resta **−0.113** (faltan 18/160 respuestas). Conclusión: **los ejemplos no cruzan de tarea**, solo entran en el prompt de extracción, no en el guion de nombramiento.
- **Proyección md activada por defecto** (`memExport.enabled`): la premisa entera del plan es «los ficheros son la autoridad del contenido + la base es el índice», dejarla apagada por defecto equivale a no usarla nunca. `mdSync.enabled` **sigue apagado por defecto** — escribe en la base, el riesgo es asimétrico.
- **Renombrada la clave del origen workspace `workspaceHints` → `workspaceSource`**: renombrado seco, sin alias de compatibilidad (esta clave nunca salió en ninguna versión publicada, añadir un alias equivale a criar una segunda fuente de verdad). Activada por defecto; la ruta enrutada `path` ahora guarda **la raíz del workspace** (el valor viejo se escribía como `E:\test\rewrite-agently\.agents`, y `targetFor` volvía a concatenar `.agents/memory` → arrojaba un árbol huérfano `.agents\.agents\memory\`; la barrera «retroceder a una única raíz solo si la raíz no existe» no intercepta esta forma). Relleno de las entradas existentes en dispositivo real: **724/1166** obtuvieron su origen, `hashRecords` literalmente invariante.

### Corregido

- **El lector del libro mayor sobrescribía la clave absoluta en `relPath`**: tras N10 las claves del libro son rutas absolutas, y esa cláusula de «reescribir usando la clave si son inconsistentes» se disparaba en cada carga; en medición real contaminó **1167/1241** entradas. Síntoma aguas abajo: el archivado de huérfanos construía un directorio ilegal con dos puntos y las 75 mudanzas daban todas ENOENT. Ahora se deriva desde `root` + clave (nueva función `deriveRelPath`) y el lado del archivado ya no confía en el `relPath` almacenado.
- **`--revert` no respaldaba los hooks**: `findArchivedOld` accedía directo a `deps.hooks.exists`, pero `runCli` al invocar revert no pasaba hooks (en apply sí estaba `deps.hooks ?? defaultHooks`, en revert faltaba). La primera vez que el sandbox corría un rollback fallaban las 74 entradas con error. Lo importante es la asimetría del daño: si apply se cae, `--revert` te devuelve; **si el propio rollback está roto, la copia de seguridad es la única salida**.
- **Duplicados entre raíces se saltaban «si ambos lados cambian, no tocar»**: `roots = raíz de caída del registro ∪ raíces ya registradas en el libro mayor`; una misma entrada puede tener un fichero bajo dos raíces distintas. La decisión leía la copia de la raíz vieja, mientras la escritura usaba la copia de la raíz nueva que calcula `targetFor` — así las ediciones humanas de la raíz vieja pisaban la copia autoritativa y el informe se veía completamente conforme. Ahora solo se reconoce la raíz de caída actual; el resto se contabiliza en el nuevo campo `staleRootFiles` y se muestra en el panel.
- **Una colisión de nombre expulsaba la memoria completa de la base recuperable**: la forma `{ ...registroViejo, id: idNuevo }` llevaba «un nombre que ya pertenece a otra fila» a escribir → chocaba contra el índice parcial único → el rebote por lotes a escritura individual seguía fallando → el producto de merge de esa entrada **desaparecía en silencio** (el registro viejo ya había salido; este reemplazo no dejaba nada). El criterio de nombrado cambió de «el nombre está vacío» a **«este nombre no le pertenece»**.
- **El contador vectorial «N entradas pendientes de embedding» nunca llegaba a cero mientras «reconstruir índice: nada que hacer»**: en la vista `missing = total − embedded` el denominador incluye filas retiradas, y las retiradas legítimamente no tienen vector por diseño; las dos consultas SQL que impulsan el completado excluyen filas retiradas, así que en la misma pantalla salían «faltan 114» y «nada que hacer» a la vez. El denominador se unifica en filas activas.
- **La barrera de proyección contaba lo recorrido, no lo ejecutado**: `maxRecords` incluía en la cuota también las entradas calificadas como «sin cambio», así que el segundo clic escaneaba otra vez los mismos N primeros — el texto del panel «otro clic para continuar» era mentira (síntoma real: `已写 9 · 未变 291 · 剩余 866` constante). Ahora solo cuenta las que tocaron disco; el total escaneado lo acota `timeBudgetMs`.
- **El libro mayor se escribía en O(n²)**: cada `set()` ordenaba todo el libro y reescribía el JSON completo de forma atómica. Con 1200 entradas en el mismo disco se midió **9442ms → 1954ms** (marcador de sucio + ventana de agrupamiento + `flush()` forzoso).
- **`NAME_MAX`(40) y `NAME_CLIP_MAX`(28) separados en dos números**: el contador de caracteres trataba igual a ASCII y a hanzi, `dsh-agent-teams` / `Python-3.13` se comían 15 unidades con una sola palabra, y nombres legítimos de una o dos palabras caían como `too-long`; pero un único 40 hacía que `deriveName` copiara la frase de narración hasta el final del enunciado (medido). De paso se corrigió el 28 fijado a mano dentro de `validateTitle` (dos fuentes de verdad para el mismo umbral).
- **Tres falsos positivos en la puerta de nombres**: la tabla de prefijos que se despojan queda **separada** de la tabla de nombres rechazados (los sujetos desnudos «usuario/equipo» dejan de matar sintagmas como «el nombre de usuario de la cuenta npm del usuario», 10 casos en dispositivo real); `has-id-fragment` se estrechó a «4+ dígitos tras un carácter no ASCII» (`ADR-0006`, `Han-1413141` pasan, 4 casos en dispositivo real).

### Límites conocidos

- El refuerzo incremental al final de la rumiación depende del diff sobre la base `id→updatedAt`, mientras relabel / retiro usan `patchMetadata` y no tocan `updated_time` ⇒ **una reescritura solo-metadata no re-proyecta en esa ronda**.
- La sincronización inversa P2 debe todavía dos piezas: el hook automático al arrancar (cambiado a exponer solo endpoint + botón) y el lote `pending` que no entra en la vista `conflicts` para arbitrar.
- **Las traducciones a 8 idiomas no se han actualizado desde 0.20.0** (esta pasada solo se añaden las entradas desde 0.22.0; el hueco 0.20/0.21 sigue abierto y queda anotado aparte).

## [0.23.0] — Sin publicar (línea local `0.23.0-local.1…8`, 2026-10-12…13)

### Añadido

- **Superficie de proyección md autoritativa (P0/P1/U/N10/N11)**: columna `l1_records.name` (clave de identidad del fichero + índice parcial único); `renderRecord` + libro mayor de doble huella (`dbDigest`/`fileDigest`) + endpoints `mem-export` / `mem-reconcile`; sección «archivo externo» del panel; raíz de proyección cambiada a **workspace primero** (`<ws>/.agents/memory/<tipo>/<nombre>.memory.md`); la detección de obsoleto se enlaza con `.memory.md.disable`.
- **P2 sincronización inversa (fichero → índice)**: **cuadrante de tres partes** según las dos digests del libro mayor — si solo cambió el fichero, se reintroduce en la base y se reescribe con el renderizado canónico (corta el bucle de escritura); si solo cambió la base, reutiliza `exportRecords` para reescribir el fichero; **si ambos cambian, ninguna de las dos se toca** y solo se cuelga `pending`; `.disable` dispara retiro sin borrar el fichero; los ficheros nuevos de procedencia desconocida solo cuentan, no entran en la base (la importación debe pasar por el núcleo de escritura). Endpoint `dsh-memory/mem-sync`.
- **P3 archivado + borrado físico**: la puerta de `exportThenPurge` cambió del hash de la base entera a **proyección por lote** (con destilaciones concurrentes, si tocaban cualquier registro ajeno al lote, la implementación vieja hacía que la limpieza nunca pudiera borrar); tras borrar se escribe un `retired.md` legible para humanos y se trasladan los ficheros proyectados del lote (incluido `.disable`) al directorio de instantánea; `cleanup-retired` en dry-run devuelve **una vista previa de la lista a borrar**; la tabla de índices de la proyección de grafo añade `forgetRecords` (hasta ahora en todo el repositorio solo se añadían y nunca se quitaban — un registro restaurado desde instantánea seguía apareciendo en la proyección y se trataba como «ya proyectado», por lo que **nunca se re-proyectaba** y el grafo de recuperación perdía esa entrada en silencio).
- **P4.1 clase por defecto `unclassified` + P4.2 normalización del formato del cuerpo (`normalizeContentMd`)**. La idempotencia es requisito duro: sin idempotencia la `fileDigest` del libro cambia cada ronda y el bucle de escritura lo introduce el propio renderizador. Solo formato, no semántica (no convierte prosa en viñetas, no inserta H1, no mete metadatos en el cuerpo).
- **Archivado de ficheros proyectados huérfanos `dsh-memory/mem-orphans`**: solo mueve los ficheros que el libro registra como «escritos por nosotros» y que ahora ningún registro reclama; los ficheros nuevos que no están en el libro **no se tocan** (puede que sean entradas humanas colocadas en el directorio de proyección esperando ser sincronizadas de vuelta). No borra, solo traslada, conservando la forma relativa y el texto original.

### Correcciones de comportamiento (vista de recuperación)

- Las entradas recuperadas dejan de desaparecer al instante: la vista trae `body` / `retired`, se deja de arrancar filas `session_recalled`, la pill muestra la anotación marginal tachada «declarada obsoleta».
- Limpieza al arrancar de residuos retirados ya existentes (en máquina local se midieron 725 filas aún sucias en `l1_fts`); se completan las dos vías laterales de escritura del invariante de retiro (arregla «tras marcar obsoleto, revive en la superficie de búsqueda»).
- Puntuación de recuperación de extremo a extremo: `-1..5` (0..5 relevancia; `-1` declara obsoleto y retira); la puntuación entra en los indicadores de madurez (`-1/1/2` hunden y hacen bajar, `4/5` elevan y hacen subir).
- Primera caída del enrutado de contenido por workspace (ecosistema dsh → `rewrite-agently`, no dsh → `agent-no-dsh`; **solo escribe `workspace_id`, no toca `scope`, no toca `updated_time`**, y sincroniza las columnas de pertenencia que lleva cada fila de `l1_fts`).

### Disciplina

- Dos megafunciones de memport divididas en dos rondas (Extract Function, comportamiento conservado, regresión byte a byte del oro del CLI).
- La disciplina de contrato de endpoint de **cinco cambios sincronizados** sigue en vigor (`MEMORY_ENDPOINTS ≡ switch ≡ doble mapa de contract ≡ recuento de contract-keys ≡ config`); cadena de recuentos 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### Añadido

- Modo triple de tema (auto/claro/oscuro) + bloque de reescritura de tokens; panel de 11 pestañas apretado a una sola fila.
- Idempotencia de `ext_key` en `memory_import` (`l1_records.ext_key` + índice parcial único + recibo `deduped`).
- **Memport Connect**: análisis / prefiltro / escaneo de `.mem` + registro de procedencias + pestaña Connect (alineación con el oro sha256 entre implementaciones).
- **Cristalización de habilidades**: skill-store (sidecar JSON) + detección de candidatos + inyección de recuperación de habilidades + interruptor del tablero `skillsEnabled`.
- G4 aristas causales del grafo (provoca / porque / arregló / reemplaza, sin subir `projectorVersion`).
- G3 madurez derivada en lectura (insignia en la ficha de registro + anotación marginal en la vista de arbitraje de contradicciones, no interviene en el arbitraje automático).
- G1 de extremo a extremo con puerta en `usageScenario` (extracción → se deposita en `metadata.dsh_usage_scenario` → reordenamiento fino en la recuperación; off deja todo literalmente igual).
- G2 plantillas narrativas por tipo (variantes de prompt bajo puerta; off es prefijo de on).
- Los ejes wing / pasillo cognitivo no se cruzan (accesores ortogonales + seguro de regresión con rangos disjuntos).
- **G-live conjunto vivo de recuperación de esta conversación**: sidecar persistente + endpoint de solo lectura `session-recalled` + lista de solo lectura en la pill.
- Proyección con conciencia de sesión en `memoryRecall` (fuente de datos de la sección «recuperado en esta sesión» del panel lateral brief, `init(header).id`).
- `cfg.slots.migrateLegacy` (apagado por defecto): retira suavemente los slots rule «afianzados como residentes cuyo contenido ya lo lleva un L1 activo».

### Corregido

- La reinyección de la rumiación revertía el contador de pendientes o lo multiplicaba (ruminate pasa mensajes vacíos, misma semántica que `enqueueSessionSlices`).
- En el finalize de la rumiación y en `doLightRefresh`: L3 forzado a correr de verdad + contador a cero + persistencia con `state.save()` (arregla «pendiente no se limpia tras rumiar L2/L3 y al reiniciar reaparece»).

### Disciplina

- Todas las capacidades nuevas vienen apagadas por defecto; en estado off, los productos y las inyecciones quedan literalmente iguales; el contrato de exhibición entre plugins (proyección `memorySlots`) sigue cableado.

## [0.22.1] — 2026-10-09

### Corregido

- **Fondo de la superposición cambiado a opaco**: el popover de memoria de la barra de entrada (`.dsh-mem-popover`) y los paneles de desplegable / filtro (`.dsh-mem-pop`) antes seguían al `--dsw-specific-menu` del huésped, y el huésped lo resuelve en un valor de vidrio semitransparente ⇒ el panel dejaba pasar el fondo. Ahora la capa de alias se superpone **sobre un fondo opaco `bg-primary`** (técnica de underlay), de modo que el panel se ve sólido sea cual sea el alpha del huésped.

## [0.22.0] — 2026-10-09

### Cambiado

- **Superficie de declaración adaptada a 15rc**: 9 peers dsh cubren todos los rc del huésped publicados (`0.1.0-rc.2..0.2.0-rc.2`, probados uno a uno con `npm view` y consistentes entre líneas), todos opcionales; `engines >= 0.1.0-rc.2` hace de cerca gruesa (la puerta fina son los peers), sincronizados `package.json` y `dsh.plugin.json`.
- **Versiones realineadas entre los dos manifiestos**: `dsh.plugin.json` había derivado a `0.20.0-beta.6-dsh0.2.0.1`, en este lote se iguala literalmente a `package.json` (puerta V1).
- **`dsh.client.inject` reducido a `ui-primitives` únicamente**: `dsh-client-connection` solo existe como paquete desde 0.1.2; declararlo colgaba toda la entrada client en 0.1.0/0.1.1 (`rpc.ts` ya resolvía perezosamente esa conexión con `ctx.get`).

### Disciplina

- En todo repositorio de tipo build se inyecta `prepack: npm run build` — `npm pack` solo dispara prepack, no `prepublishOnly`; es una de las tres capas de defensa contra el falso stale-build.

## [0.21.0] — 2026-10-04

### Añadido

- **Sellado por grupos de herramientas (panel de memoria → Memoria → Sellado de herramientas)**: 5 conmutadores (gestión de room / graph / ruminate / conflict / mutate escritura-borrado, cubriendo 13 herramientas). Apagado = las herramientas de ese grupo **no se registran**, desaparecen directo de la lista de herramientas del modelo (no un rechazo en tiempo de ejecución); el volteo se aplica al instante vía hot update volatile, sin reiniciar. Las lecturas núcleo (memory_search / memory_read_scene / memory_receipts / conversation_search) y las tres piezas de ranuras no están bajo control. Contexto: la mayoría de las herramientas agrupadas (p. ej. la gobernanza de Room, la rumiación) se usan con una frecuencia bajísima en el día a día, así que tenerlas residentes en la lista de herramientas solo gasta atención e induce al modelo a invocarlas por error.
- **Comprobación de existencia de las referencias mem_ en memory_slot_write**: los record_id L1 de forma `mem_*` dentro de los refs pasan por una comprobación de existencia `getByIds` antes de escribirse; un id alucinado o mal escrito se rechaza en el acto con un aviso de pasar por memory_search — garantizando que «las memorias activadas por la búsqueda» que entran en una referencia de ranura sean necesariamente registros reales (la resolución de resumen de nombre del lado brief tiene así una entrada fiable). Los refs de ruta de archivo / URL no se comprueban.

## [0.20.4] — 2026-10-04 (build local, sin publicar)

### Corregido

- **Tolerancia a fallos integral en la resolución de refViews de la proyección**: la llamada a L1 `getByIds` dentro de `resolveRefViews` queda envuelta en try/catch — el drive del registro no tiene protección de excepciones, así que cualquier fallo en la capa de resolución (sqlite ocupado / degradación del backend / estado anómalo del registro) se llevaba por delante todo el controlador de eventos de sesión e incluso el proceso del huésped. Ante un fallo degrada a que ese fotograma no lleve refViews (el frontend retrocede a los refs crudos).

## [0.20.3] — 2026-10-03

### Corregido

- **El texto renderizado de `memory_search` ahora añade el id**: v0.20.2 metió el record_id en el JSON de salida y en el schema, pero el modelo ve el producto del render, no el JSON crudo — la línea renderizada no llevaba el id, lo cual para el modelo equivale a no devolver nada (descubierto en retest en máquina real). Ahora cada resultado termina en `— id: mem_xxx`, escribible directo en los refs de ranura.

## [0.20.2] — 2026-10-03

### Corregido

- **El juicio de suciedad de `memorySlots` de la proyección relajado a cualquier evento**: antes la suciedad se juzgaba por la rev del store solo en `tool/result` (settled, sin error) — tras una escritura dependía de que «llegara justo otro resultado de herramienta» para refrescar, y la consulta entre sesiones debía esperar a las propias llamadas a herramientas de la sesión que consulta; la máquina real dejó al descubierto que la barra lateral se quedaba mucho tiempo en un fotograma vacío tras escribir. Se cambia a una comparación de rev O(1) sobre cualquier evento confirmado: si la rev cambia, se reconstruye y empuja; la guarda isError se elimina (la rev solo se incrementa tras un cambio real; el evento es solo un disparador, no la fuente de datos).
- **La inyección permanente pasa a un fotograma con etiqueta `<system-reminder>`** (alineado con el house style de inyección AGENTS.md de dsh-agent-instructions): el portador con rol user no cambia, pero ahora se presenta como una caja de etiqueta + declaración de autoridad (no requiere respuesta / no repetir / no anula los prompts del sistema ni las instrucciones directas del usuario) — corrige los modelos débiles que repetían literalmente el contenido de la ranura como si fuera habla del usuario e interferían con la respuesta normal; las etiquetas de cierre del cuerpo de la ranura se escapan (`</system-reminder>`) para impedir que el contenido de la ranura finja el límite del fotograma.

### Añadido

- **Los resultados de `memory_search` exponen `id` (record_id L1)**: rompe el bloqueo de «la recuperación no obtiene id → no puedo escribir refs de ranura / alimentar memory_receipts»; la descripción del schema anota los dos destinos del id.
- **La vista de cable expone `refs` + `refViews`**: las referencias de tipo `mem_*` se resuelven al construir el fotograma de proyección vía L1 `getByIds` a `[type] 名称简述` (primera línea del content, truncada a 80 caracteres), brief-sidebar (≥0.5.0-beta.2) las renderiza directo; las referencias de ruta/URL se mantienen literales; los registros faltantes o retirados no generan entrada. La resolución ocurre al construir el fotograma — el conjunto de referencias se congela al escribir la ranura, así que ediciones posteriores del registro L1 no refluyen a los fotogramas viejos. El schema autoimplementado valida los campos adicionales solo «si existen», de modo que las filas checkpoint viejas pasan enteras (stateVersion intacto).

## [0.20.1] — 2026-10-03 (promovida a estable; el canal beta consolida desde beta.1 todas sus capacidades)

La cadena completa de gestión de clasificación Hall·Room (registro de dos niveles / merge / rename / retire / update / adopción / retiro con registros / retirar un no registrado añade entrada al registro), páginas de gestión independientes para Hall y Room (filtro de búsqueda, plegado por defecto, clasificación por arrastre con puntero, filtro de retiro), muestra del peso de envejecimiento + estadísticas de uso del recuerdo (solo entrar en topN cuenta como usado). El último beta antes de promover fue 0.20.0-beta.26, idéntico en contenido a 0.20.1; el canal `dsh-0.2.0-beta` sigue recibiendo los betas posteriores.

## [0.20.0-beta.26] — 2026-10-03

### Añadido (usabilidad tras el crecimiento de Hall/Room)

- **Filtro de búsqueda por nombre Hall/Room**: la página Hall gana un cuadro de búsqueda (slug, nombre visible, alias, sin distinguir mayúsculas) — un acierto sobre el propio hall muestra todas sus rooms hijas, si no solo se conservan las rooms hijas que aciertan, y un grupo sin ningún acierto se oculta; al buscar, los grupos que aciertan se despliegan solos (el estado plegado ya no esconde los resultados); la zona auto-crecida no registrada se filtra igual. La página Room trae el mismo cuadro de búsqueda, que se compone con los chips del filtro de retiro.
- **Plegado de grupos Hall, plegado todo por defecto**: la cabecera del hall solo muestra «total N entradas · M rooms», tocar la cabecera o el botón ▸/▾ despliega/pliega las rooms hijas; botones en lote «desplegar todo / plegar todo»; el estado de despliegue se recuerda en localStorage (`dsh.memory.halls.open`). La prioridad de la clasificación por clic (tocar la cabecera del hall para completar la clasificación) no cambia.

## [0.20.0-beta.25] — 2026-10-02

> Corrección del estado invisible de las rooms auto-crecidas tras el retiro + regla de muestra de rooms hijas de Hall (fallo del usuario).

### Corregido / Cambiado

- **Las rooms auto-crecidas no registradas pasan a «retirado / recuperar» al retirarse**: antes el retiro solo borraba lógicamente los registros, el vocabulario no tenía entrada que cambiar y el botón siempre era «adoptar / retirar». Ahora retire withRecords, para un slug no registrado, **añade por sí solo una entrada de registro grown y la pone retired** — la fila del panel cambia al instante al estado «retirado», y «recuperar» (active:true) la devuelve al vocabulario. Persistido, no se pierde al reiniciar.
- **La página Hall solo muestra rooms active**: las rooms retired/retiradas ya no aparecen bajo el agrupamiento del hall (véanlas en la página Room, que incluye un filtro «retirado»); el recuento agregado del grupo incluye por tanto solo subtipos active.

## [0.20.0-beta.24] — 2026-10-02

### Corregido

- **Desplegar/retirar en la página Hall alineado con la página Room**: desplegar una fila de room en la página Hall también trae solo los registros activos (`retired:false`); tras confirmar un retiro, si esa room está desplegada, la zona desplegada se refresca sola. (beta.23 solo parcheó la página Room, la página Hall se quedó sin sincronizar — el otro punto detrás de lo que el usuario observó en máquina: «retiro pero no veo efecto».)

## [0.20.0-beta.23] — 2026-10-02

> **Filtro de retiro de la página Room completado** (los chips del filtro de beta.22 nunca llegaron al disco por un fallo a mitad del script de parche, solo la insignia entró en el paquete — esta pasada escribe cada ítem al disco vía Edit y verifica todo en verde).

### Corregido / Añadido

- **Chips del filtro de retiro** (página Room, sobre el formulario de registro): todos / activos (vocabulario no retirado) / retirados.
- **Efecto del retiro instantáneo**: desplegar una entrada trae solo registros **activos** (`retired:false`) — tras el retiro, la zona desplegada muestra «no hay entradas de memoria»; si la room está desplegada tras confirmar el retiro se **refresca sola**; insignia [retirado] + atenuado como respaldo (ya en beta.22).

## [0.20.0-beta.22] — 2026-10-02

> Visibilidad del efecto del retiro + filtro de retiro de la página Room (feedback en máquina real: tras confirmar el retiro la interfaz no mostraba cambio y no había forma de filtrar).

### Corregido / Añadido

- **Efecto del retiro instantáneo**: desplegar una entrada en la página Room trae solo registros **activos** (`retired:false`) — tras el retiro la zona desplegada muestra «esta Room no tiene entradas de memoria»; si esa room está desplegada tras confirmar el retiro, sus entradas se **refrescan solas**; respaldo en lista mixta: las entradas retiradas muestran una insignia [retirado] y se atenúan.
- **Filtro de retiro**: la página Room gana chips «todos / activos / retirados» (un filtro por estado de retiro del vocabulario).

## [0.20.0-beta.21] — 2026-10-02

> **Retirar con registros**: al retirar un room se puede opcionalmente **retirar junto todas sus memorias activas** (antes solo existía la tabla de verbos, y las rooms auto-crecidas en particular no tenían forma de procesarse).

### Añadido

- **`retire withRecords`** (botón «retirar» de las páginas Room/Hall, rojo): retiro del vocabulario + borrado lógico por lotes de todos los registros **activos** bajo ese room (cada lote ≤200, el mismo primitivo que records-delete; reason=manual) — los registros se pueden recuperar uno a uno en la zona «retirados» de la página de memoria. Una fila auto-crecida no registrada también tiene «retirar» (solo retira registros, no hay entrada de vocabulario que mover). La respuesta trae un recuento `retiredRecords`.
- El botón «exportar huérfanos» vuelve al **panel de consulta de memoria** (en línea dentro de la fila del filtro de huérfanos).

### Corregido

- aislamiento de pruebas de recall-usage (un caso de ida y vuelta persistido entraba en carrera bajo paralelismo); corrección de la muestra del `\n` literal en el diálogo de confirmación de retiro de RoomTab.

## [0.20.0-beta.20] — 2026-10-02

> **Room en pestaña propia** (separada de Hall): la existencia, el nombre y las entradas de un room tienen cada uno su superficie de gestión; la página de memoria ya no amontona etiquetas Room.

### Añadido

- **La pestaña «Room»** (después de Hall): una lista plana de todos los rooms (entradas registradas ∪ auto-crecidos no registrados) — **existencia** (registrar un slug de dos niveles / adoptar grown / retirar·recuperar), **nombre** (editar el nombre visible + la nota de clasificación; renombrar puede usar un slug de dos niveles, los registros lo siguen), **entradas** (▸ desplegar para recorrer las entradas de memoria de ese room, plegado por defecto, primera carga de 10); la exportación de huérfanos y los conmutadores de altos privilegios van con la página.
- **Re-editable tras registrar**: un nuevo `room-admin update` (reescribe label/description, los campos no proveídos quedan intactos) + el store `RoomRegistryStore.update` + la herramienta `memory_room_admin action=update` + una entrada «editar» en el panel — antes, tras registrar, el label/nota solo podía completar vacíos, no reescribirse.
- **Despliegue de contenido en la fila de room** (igual que las filas de room de la página Hall): plegado por defecto, ▸ despliega para ver entradas.
- **Bloque Room de la página de memoria separado**: se quitan los chips de slug / paginación / bloque desplegable (duplican las páginas Hall/Room), conservando solo el filtro de huérfanos «sin vínculo · N» y el texto de guía — recorrer/gestionar etiquetas de room corresponde a las páginas Hall/Room.

### Cambiado

- Los formularios y la vista previa de merge/clasificar/renombrar quedan pegados al scroll (sticky) (con muchos halls ya no hace falta deslizar arriba y abajo buscando el diálogo de confirmación).
- Arrastre propio por puntero (el mismo esquema pointer de ego-browser, un respaldo para webviews donde el DnD de HTML5 no dispara).

## [0.20.0-beta.19] — 2026-10-02

> Clasificación rehecha (feedback en máquina real: el arrastre HTML5 no dispara en algunos webviews; tras tocar un hall la vista previa quedaba enterrada en la fila origen y parecía «sin respuesta»).

### Cambiado

- **Arrastre propio por puntero** (el mismo esquema puramente pointer de ego-browser): mantener pulsado un room / slug auto-crecido → un chip fantasma flotante sigue al dedo → pasar sobre la cabecera de un hall la resalta con línea discontinua → soltar para clasificar. No depende del DnD de HTML5, funciona en cualquier webview. Se conserva la clasificación por clic («clasificar» / «asignar» → estado de selección → tocar la cabecera del hall).
- **Barra de acciones global**: los formularios de merge/clasificar/renombrar y la vista previa dryRun quedan **permanentes al principio de la página** (el diálogo rojo de confirmación no se desliza con la fila y ya no queda enterrado en la fila del room origen) — tras tocar un hall siempre se ve.
- **Diseño de la fila de room**: los botones fijados en una fila ya no se parten (Exportar ya no queda solo en su línea); nombre/alias ajustan natural en el área de información izquierda (los alias pueden romperse a mitad de palabra).

## [0.20.0-beta.18] — 2026-10-02

### Mantenimiento

- limpieza de lint: las dos importaciones muertas dejadas en stats.ts / rooms-registry.ts por la sustitución isTag→isRoomSlug de beta.17 (la puerta de publicación no las detectó — tras el pipe `$?` tomaba el código de salida de tail, reincidiendo en la trampa D2). Sin cambio funcional.

## [0.20.0-beta.17] — 2026-10-02

> **Corrección de la pérdida de relaciones hall/room tras reiniciar**: el cargador de `rooms-registry.json` seguía filtrando los slugs con `isTag` — al releer desde disco tras reiniciar, todas las entradas de dos niveles `major/minor` se tomaban por ilegales y se **descartaban en silencio** (los halls de un solo segmento pasaban, así que sobrevivían). Es el tercer punto del embrollo isTag/isRoomSlug; la misma tanda desactivó la mina gemela en `normTags`.

### Corregido

- **El cargador descartaba entradas de dos niveles** (init de `store/rooms-registry.ts`): el filtro pasa a `isRoomSlug`. **Los datos de rooms-registry.json en su disco estaban intactos** (las entradas de dos niveles siempre estuvieron en el archivo, solo se descartaban al arrancar) — tras actualizar y recargar las relaciones se recuperan solas, sin acción de reparación.
- **normTags lavaba las etiquetas con slash** (`metadata-validators.ts`): la puerta «todos los puntos de reescritura de tags deben pasar por aquí» usaba isTag, así que una etiqueta `hall/minor` reescrita por la clasificación se despojaba en silencio la próxima vez que la destilación o el reetiquetado la tocara. Ahora pasan los slugs de room de dos niveles (los de tres siguen rechazados); la fuente de verdad `isRoomSlug` se trasladó a este archivo (para evitar un ciclo de dependencias), y la reexportación de rooms-registry sigue compatible.
- **El filtro de etiquetas de dos niveles de list-records era rechazado por error** (misma forma que tagSel de stats.ts): se cambia a `isRoomSlug` — tocar el filtro de registros de un room de dos niveles en la página Hall devolvía 400.
- Prueba roja primero ×3 (ida y vuelta de dos niveles en persistencia / normTags deja pasar / integración de filtro de etiquetas de dos niveles), verificado en rojo y corregido a verde.

## [0.20.0-beta.16] — 2026-10-02

> **Slugs auto-crecidos no registrados clasificados directo en un hall**: cada chip del área «auto-crecido no registrado» del fondo ahora se puede arrastrar a una cabecera de hall — adopción + volverse su subtipo en un paso.

### Añadido

- **Arrastre / clic para clasificar el chip grown**: arrastrar un slug no registrado (p. ej. `git-commits`) a la cabecera de un hall (o tocar el botón «asignar» del chip para entrar en estado de selección, luego tocar el hall objetivo) → vista previa dryRun → confirmar para ejecutar de verdad. Semántica = **adopción en el sitio (from, source=grown) → rename a `hall/子类`**: las tags de los registros lo siguen, el nombre viejo entra en los alias del objetivo, la entrada queda active y no luce ⭐ (identidad de adopción). Volver a un slug de dos niveles bajo su propio hall (p. ej. `dsh-plugin/xxx`) = adopción en el sitio.
- El orden de la composición queda clavado en una prueba de integración (markMered sale antes con un from no registrado — primero hay que adoptar el from, luego renombrar); execMerge adopta automáticamente un from no registrado.

## [0.20.0-beta.15] — 2026-10-02

> Dos correcciones seguidas del feedback real de clasificación: ①una entrada renombrada llevaba por error «retirado» (se caía del vocabulario de anotación); ②el arrastre HTML5 no funcionaba en algunos webviews → se añadió la vía principal de **clasificación por clic**.

### Corregido

- **Entrada marcada retired por error tras clasificar (renombrar)**: renameRoom reutiliza la orquestación de merge, y el «la entrada vieja pasa a retirada» de `markMerged` venía arrastrado — el room recién clasificado mostraba «retirado» y **se caía del vocabulario del anotador** (el filtro listActive). Ahora el cierre de rename restaura el estado previo (una entrada active sigue active tras renombrar); un merge real (semántica de unión) no se afecta. Prueba roja primero (unit + integración de superficie HTTP).

### Cambiado

- **La clasificación por clic como vía principal**: tocar «clasificar» de la fila de room → entrar en estado de selección (el botón pasa a «elegir hall…», todas las cabeceras de hall resaltan con línea discontinua) → tocar la cabecera del hall objetivo → sale la vista previa dryRun → confirmar para ejecutar. El arrastre se conserva (sigue usable en entornos que lo soportan), pero ya no se depende de él.

## [0.20.0-beta.14] — 2026-10-02

> Las tarjetas de memoria ganan la muestra de **peso de envejecimiento** y **uso del recuerdo**, y empieza a acumular datos para la «estadística de efectos del peso de envejecimiento». Definiciones (fallo del usuario): **solo entrar en topN (ser inyectado en el contexto) cuenta como usado**; un intento de participación que no entró = solo cuenta el intento.

### Añadido

- **Campos de la tarjeta**: un chip «envejecimiento N%» (el coeficiente de decaimiento de la vía de lectura `max(0.5, 0.5^(Δ天/半衰期))`, misma fórmula y misma fuente que el orden del recuerdo; ≤60% se marca rojo = envejecido) + un contador «usado used/attempts» (el title lleva las horas de último uso / último intento). La barra de herramientas gana el resumen «uso del recuerdo used/attempted(rate%)».
- **Superficie de estadísticas**: `RecallUsageStore` (un sidecar recall-usage.json, de la misma familia de disciplina que rooms-registry — un archivo dañado cae a degradación de solo lectura, sin bloquear jamás la vía de lectura del recuerdo); cada ronda de recuerdo registra en los tres estados finales (inyección / todo suprimido / presupuesto a cero) (candidatos attempts++, inyectados used++, la marca de tiempo toma la más reciente); inmediato en memoria + volcado atómico con debounce de 5s, 50 000 entradas desalojadas por intento más reciente; sin montar = un bypass de coste cero.
- Contrato: UiRecord gana `agingWeight`/`usage`, ListRecordsResponse gana `usageSummary` (campos opcionales, cero rotura para clientes viejos); el número de claves del contrato no cambia.

### Definiciones de la estadística de efectos (para análisis posterior)
- usageSummary: tracked (memorias con estadística de uso) / attempted (Σ intentos) / used (Σ usados) / rate (uso %)
- El análisis fino (distribución de uso por tipo/banda de edad, base para ajustar la vida media) acumula datos desde esta versión; la vista de análisis se discutirá aparte.

## [0.20.0-beta.13] — 2026-10-02

> Lógica de clasificación completada: poner un room bajo un hall existente (antes solo se podía añadir un hall nuevo, o fusionar en otro room borrando su identidad). El panel soporta **clasificación por arrastre** — arrastrar un room y soltarlo sobre la cabecera de un hall.

### Añadido

- **Arrastrar para clasificar en la página Hall**: una fila de room es arrastrable (cursor de agarre cuando hiPriv está activo), las cabeceras de hall son objetivos de soltar (resaltado discontinuo); soltar = un rename prefijado (major/minor) directo a una vista previa dryRun, confirmar para ejecutar — los registros lo siguen, el nombre viejo va a los alias, la vista agrupada lo cuelga bajo ese hall. Pantallas táctiles / entornos sin arrastre usan como respaldo el botón «clasificar» de la fila de room o los chips de preselección rápida de hall del formulario de rename.
- Corrección de backend: la validación del objetivo de `renameSlug` `isTag` → `isRoomSlug` — antes los objetivos de dos niveles (major/minor) eran rechazados por error, así que la vía «clasificar bajo un hall» no funcionaba (y la orquestación de rename reescribía primero los registros y luego lanzaba al renombrar el registro, dejando un estado a medio hacer). Según la disciplina de retirada/cambio C3: prueba roja primero (unit + integración de superficie HTTP, una cada una), verificado en rojo y corregido a verde.

### Corregido

- Igual que arriba: la validación de objetivo de dos niveles de `renameSlug` (un hueco introducido en beta.5).

## [0.20.0-beta.12] — 2026-10-02

> limpieza de lint + disciplina de retirada puesta por escrito (C3 añadido a ENGINEERING-NOTES). **Sin cambio funcional**.

### Mantenimiento

- **Limpieza de eslint (13 error → 0)**: residuos de la retirada de longtask (importaciones muertas de stats.ts ×2, estado muerto de RecordsTab) + deudas de tandas anteriores (interfaz y let muertos de recluster.ts, importaciones y let muertos de rooms-registry.ts / ruminate.ts / room-review.ts / dos archivos de pruebas). Los 4 warning restantes son del baseline preexistente (el any de primitives/tools).
- **C3 «retirar también es TDD» añadido a ENGINEERING-NOTES**: retirar primero cambia las pruebas para expresar la nueva expectativa (rojo) → luego se quita la implementación (verde); lint es una puerta obligatoria para los cambios de tipo borrado (una importación sin usar = un detector automático de «no se quitó del todo»).

## [0.20.0-beta.11] — 2026-10-02

> **Pruebas de integración** Hall·Room incorporadas (`tests/hall-room.integration.test.ts`: cadena completa de superficie HTTP × viaje de usuario con almacenamiento real, 9 casos); la primera corrida de integración atrapó y corrigió un ángulo ciego de las pruebas unitarias.

### Corregido

- **La vista fusionada de rooms-get fijaba el source a `pre-registered`** (introducido en beta.4): al incorporar las entradas del registro a la lista de recuentos se escribía el origen fijo, así que una entrada adoptada (source=grown) llevaba siempre la insignia ⭐ pre-registrada en los chips de recuento del panel — identidad falseada. Ahora usa el origen real de la entrada (⭐ solo para pre-registrado; la adopción muestra grown). Causa del ángulo ciego unitario: las pruebas unitarias de rooms-registry solo probaban la capa del store, y nadie asertaba el source de una entrada grown en la fila fusionada del endpoint.

### Pruebas

- `hall-room.integration.test.ts`: recuento auto-crecido con tabla vacía → registro de dos niveles / rechazo de slug ilegal → adopción → exportar tres kinds → merge dryRun con cero escrituras → ejecución real (respaldo a disco / reescritura de la fila de retiro / preservación de metadata / encolado de recálculo de escena source='room-merge') → alias de rename → retire/recuperar → tope de 200 de la clase grande + la clase pequeña no consume cuota → línea roja de degradación a solo lectura con archivo dañado (rooms-get no bloquea, el disco no se reescribe).

## [0.20.0-beta.10] — 2026-10-02

> **Retirada total de longtask (modo de tarea larga)**: esta familia tenía su hogar en el lado de context-compression («sugerir iniciar la compresión» es su dominio), pm lo cargó por error — beta.8 quitó la bola flotante, esta versión quita el backend restante. pm vuelve al dominio puro de memoria. Si más adelante se necesitara «destilar la cola ya» y parecido, rediseñélo desde la propia posición de pm y vuelva a iniciarlo como proyecto.

### Eliminado

- **Endpoints `longtask-hint-get` / `longtask-compress-tail`** (claves de contrato 48 → 46) y el bucle cerrado `compressTailTurns` / ruminate con debounce: la medición de contexto (`ContextUsageStore`), la detección de deriva de todo (`TodoRefStore`), la decisión de sugerencia — todo se retira a la vez, `hooks/long-task.ts`, `store/context-usage.ts`, `store/todo-ref.ts` tres archivos borrados (incluido el augmento declare module del evento todo/write).
- **El bloque de config `cfg.longTask.*`** (valores por defecto + dos sitios de Schema): las claves longTask en los archivos de config viejos las ignora el schema, sin necesidad de migrar.
- **El flag `longTask` de nivel de sesión y la línea de marca de compresión de cola `lastTailCompressedTurn`** (session-modes): las claves residuales en el session-modes.json viejo las ignora naturalmente el filtro de carga.
- **El `mode` de `session-mode-set` vuelve a ser obligatorio** (esa opcionalización había nacido solo para el uno-o-otro con longTask); se borran los campos `longTask` de petición/respuesta.
- Se conserva: la corrección del cableado RPC de roomRegistry de beta.9 (se sostiene por sí sola); la página de gestión Hall y la superficie de gestión de clasificación Room sin cambios.

## [0.20.0-beta.9] — 2026-10-02

> Corrección de los deps que se perdían en toda la cadena RPC del panel: `roomRegistry` y `longTaskDeps` se perdían cuando el rpcHandler ensamblaba las sources, así que en el panel los endpoints de gestión de Room / tarea larga siempre decían «no montado» (la superficie de herramientas los pasaba directo y no se afectaba, de ahí que las herramientas funcionaran desde beta.4 mientras el registro del panel daba error constantemente).

### Corregido

- **El rpcHandler de `registerMemoryRpc` perdía `roomRegistry`/`longTask`** (introducido en beta.4): la distribución HTTP pasa uniforme por `buildEndpointDeps`, pero las sources solo llevaban 7 ítems — `rooms-get` no bajaba el registry, `room-register`/`room-admin` lanzaban «el registro de Room no está montado (necesita recargar el plugin para inicializar)», `longtask-hint-get`/`longtask-compress-tail` estaban siempre disabled. Ahora se bajan con las sources; una prueba de regresión clava toda la cadena de superficie HTTP (register → rooms-get merge → room-admin, rpc.test.ts).

## [0.20.0-beta.8] — 2026-10-02

> Se quita la UI de bola flotante: el panel flotante de sugerencias tenía su hogar en el lado de context-compression («sugerir iniciar la compresión» es su dominio), pm lo cargó por error — el FAB que venía con el paquete desde beta.1 se retira en esta versión.

### Eliminado

- **Bola flotante + tarjeta de sugerencia (`client/src/longtask-fab.ts`, incluida desde beta.1)**: se retira por completo, el cliente vuelve a dos superficies — `settings.section` (panel de memoria) + `conversation.input.left` (pill de nivel), ya no hay UI flotante a nivel de toda la aplicación. El modo de tarea larga en sí (medición de contexto / referencia de todo / compresión de turnos de cola) no se afecta; los endpoints `longtask-hint-get` / `longtask-compress-tail` se conservan como superficie backend, y el conmutador de tarea larga y la entrada de compresión manual caerán en la sección de ajustes de memoria al fijar la versión.

## [0.20.0-beta.7] — 2026-10-02

> Tercera travesía de la gestión de clasificación Room (el **volumen del panel de gestión**): una pestaña «Hall» dedicada, hall (clase grande) + room (clase pequeña) gestionados juntos — ver/gestionar Rooms a mano ya no tiene que pasar por la herramienta del agent.

### Añadido

- **La pestaña de gestión «Hall»** (después de «Escena»): un árbol de agrupamiento de halls — `major/minor` van bajo su clase grande de prefijo, un slug standalone forma su propio hall (es a la vez hall y el único room bajo él); la fila de cabecera del hall agrega recuentos + un clic «+clase pequeña» (prefijado `hall/`); las filas de room muestran ⭐pre-registrado / source / estado / alias / recuentos, los retired atenuados. Los términos de UI Hall/Room son la vista de agrupamiento, sin relación con Wing (el dominio `metadata.hall`) ni con el hall cognitivo (desambiguación ADR-0020 §7).
- **Entrada UI de operación completa (puerta memoryMutate de altos privilegios)**: registro de slug de dos niveles (un formulario controlado, placeholder `dsh-plugin` / `dsh-plugin/merge`); **adopción** de slug auto-crecido (`source=grown`); **renombrar/fusionar** vía el nuevo RPC — vista previa dryRun (recuento afectado + muestras) → «confirmar ejecución» real, la misma orquestación que la herramienta memory_room_admin (respaldo automático antes de ejecutar + encolado de recálculo de escena al completar); retirar/recuperar con un clic (recuperar no pide segunda confirmación, retirar sí); una exportación CSV de la lista de registros por room; la exportación de vocabulario/huérfanos se reúne en esta página; renombrar/fusionar traen un aviso «ejecutar cuando la rumiación esté ociosa».
- **Nuevo endpoint `dsh-memory/room-admin`** (merge/rename/retire; puerta memoryMutate, semántica de lanzamiento desde el endpoint): claves de contrato 47 → 48. `rooms-export` gana `kind='records'` (exportar lista de registros por Room, `tag` obligatorio); `room-register` gana un `source` opcional (la adopción pasa `grown`).
- El bloque Room de la pestaña de memoria adelgazado: se quita el subpanel de gestión (la exportación de huérfanos sube a la fila de cabecera), el aviso apunta a la página Hall.

### Corregido

- El estrechamiento de tipo del kind de la rama records de `rooms-export` (TS2322) y un texto de error histórico con basura; corrección de la línea de título duplicada beta.1-beta.5 del CHANGELOG.

## [0.20.0-beta.6] — 2026-10-01

### Corregido

- **El vocabulario del anotador conectado al registro (el ítem faltante de beta.5 completado)**: el merge/rename/retire de beta.5 ya había caído, pero el vocabulario del anotador de candidatos (`annotateOrphanCandidates`) seguía siendo un agregado puro auto-crecido — los Rooms pre-registrados no podían entrar en los candidatos en absoluto. Ahora OrphanAnnotateIO lleva un registry: el vocabulario fusionado = las entradas del registro ordenadas primero (count=0, con label/description) + el directorio auto-crecido, con tope 120; las dos rutas de anotación de ruminate y memory_room_admin pasan el argumento. **Los Rooms pre-registrados ahora influyen de verdad en la anotación de candidatos.**

## [0.20.0-beta.5] — 2026-10-01

> Segunda travesía de la gestión de clasificación Room (la **superficie destructiva**). dryRun es true por defecto — merge/rename previsualizan primero la superficie de impacto, se ejecutan solo tras confirmar; respaldo automático a `rooms-merge-backups/` antes de ejecutar.

### Añadido

- **Sistema de dos niveles del registro de Room**: los slugs admiten forma `major` o `major/minor` de dos niveles (p. ej. `dsh-plugin`, `dsh-plugin/merge`); **tope de clase grande 200**, las subdivisiones de clase pequeña no consumen la cuota de la clase grande (un seguro global de 2000). El vocabulario isTag no se relaja (el slash solo se permite en la capa del registro).
- **merge/rename/retire (herramienta `memory_room_admin`, altos privilegios)**: merge reescribe con un cursor las tags de todos los registros coincidentes (releer-fusionar-escribir antes de escribir, claves preservadas entre roomCandidates/roomReview/hall/anchors etc.; incluye filas ya retiradas, coherente con la definición de recuento); rename = merge 1:1 + renombrar en el registro (los aliases absorben el nombre viejo); retire es solo retiro del vocabulario (lo existente no se toca). merge/rename en paralelo con la rumiación se pisan entre sí — escalónelos en horas distintas (tanto el aviso de la herramienta como ADR-0020 lo declaran).
- **El trío de seguridad de reescritura**: dryRun por defecto devuelve solo affected + vista previa con cero escrituras; respaldo automático de los registros coincidentes a `rooms-merge-backups/<ts>-<slug>.json` antes de ejecutar; al terminar `invalidateRooms` automático + encolado de recálculo de escena por cada (family, scene) afectado (`source='room-merge'`).
- **Subpanel de gestión Room del panel** (aparece tras activar altos privilegios): formulario de registro (slug/nombre/descripción, vía el nuevo RPC `room-register`), exportación de lista de huérfanos; las sugerencias de fusionar/retirar van por la herramienta del agent (la vista previa dryRun es más detallada).
- Superficie de endpoints 46 → 47 (`room-register`).

## [0.20.0-beta.4] — 2026-10-01

> Primera travesía de la gestión de clasificación Room (la **superficie de cero deriva**): un registro vacío = comportamiento idéntico byte a byte a beta.3. La superficie destructiva merge/rename/retire llega con beta.5 (dryRun true por defecto se retiene una versión).

### Añadido

- **Registro de Room (un sidecar `rooms-registry.json`)**: pre-registra Rooms planificados (slug/label/description); dañado/vacío → degrada de vuelta a un directorio puro auto-crecido, sin bloquear jamás el panel ni el anotador; tope 200 para evitar spam. La capa de endpoint de `rooms-get` fusiona: una entrada registrada entra al vocabulario aunque count=0 y trae `source`/`label`, la respuesta gana un campo `registry` completo (lectura opcional por el cliente).
- **Endpoint de exportación `dsh-memory/rooms-export`** (kind=rooms|orphans, salida CSV directa): rooms = registro ∪ vocabulario auto-crecido con recuentos; orphans = la lista de registros activos sin vínculo de Room (incluidas las columnas de estado candidato/reinspección).
- **Herramienta `memory_room_admin`** (action=list|register): list muestra el registro + el panorama auto-crecido; register pre-registra un Room (puerta de altos privilegios, compleción idempotente) — junto con la reinspección ítem por ítem de `memory_room_review`, el agent gana una entrada completa de gestión de clasificación «registrar → premarcar → confirmar uno a uno».
- Cliente: los chips de Room traen una insignia de origen «pre-registrado / auto-crecido»; los chips de huérfano traen la semántica de reinspección pendiente.

## [0.20.0-beta.3] — 2026-10-01

### Añadido

- **Mejoras de clasificación Room del panel de registros**: ①desplegar/plegar (plegado = cabecera + una vista previa de los 8 Rooms de alta frecuencia, estado de apertura/cierre persistido); ②paginación completa en el estado desplegado (40 por página, ◀▶ para paginar), reemplazando el corte duro anterior de «solo los primeros 40»; ③**filtro de memorias huérfanas** — un chip «sin vínculo · N» en primera posición que muestra solo memorias sin ningún vínculo de Room (`list-records` gana un canal de filtro `untagged`, `rooms-get` gana `orphanCount`, misma definición que el recuento de Room); ④condiciones de filtro visibles al instante + borrado con un clic. La vía de recuperación trae el mismo filtro de huérfanos.

## [0.20.0-beta.2] — 2026-10-01

> Canal dsh-0.2.0-beta +1: optimización de contexto completo de la rumiación (cerco blando de repo / migración de escenas por proyecto / bucle cerrado). Empaquetado con longtask (ver beta.1), feedback de máquina real consolidado.

### Añadido

- **Cerco blando de repo (ADR-0015, `recall.scopeFence.*`, apagado por defecto)**: repoKey=basename(cwd normalizado) calculado al escribir dentro del metadata L1 (repo_key_name/repo_key_owner/applicability, DEFAULT con relleno cero, no entra en el FTS ni en el hash de instantánea); las salidas de recuerdo y memory_search rebajan el peso de forma blanda por `this-repo` / `cross-project` (×0.2 ajustable, **solo rebaja, nunca excluye**, la familia chat y los registros sin atribución no se cercan, un centinela de la vía de deduplicación evita entradas erróneas). Cero deriva: apagado por defecto, el orden del recuerdo empareja sha1 idéntico.
- **Migración de escenas por proyecto (percepción de repo en L2 + reagrupamiento)**: el prompt de consolidación L2 ve repoKeyName/applicability — los registros this-repo ya no se fusionan en escenas cross-project; una cola `scene_recluster_jobs` + un consumidor de banda ociosa de ruminate (instantánea → borrar proyección de resumen → rollback total ante fallo, cero canal LLM nuevo); tras reparar la atribución de repo consulta solos por repoKey las escenas afectadas y encola el recálculo.
- **Bucle cerrado de compresión**: un disparo de rumiación con debounce de 10 minutos tras un encolado de compresión de cola exitoso (lavado → L2 → L3 → reetiquetar → consumo de reagrupamiento), corrigiendo el corte de «registros comprimidos estancados en el cubo de destilación».

## [0.20.0-beta.1] — 2026-10-01

> Primer lanzamiento de canal beta de la línea dsh-0.2.0 (tag `dsh-0.2.0-beta`): vista previa en máquina real del modo de tarea larga. Además de lo de abajo, esta versión carga también todos los cambios de main aparcados antes en `[Unreleased]` (ranuras de activación / anclas de procedencia / lector de pruebas / bucle cerrado de retiro de memorias / conflictos de tres ejes etc.) — ya salieron con la línea 0.1.7, pero la línea main no tenía un número de versión correspondiente.

### Añadido

- **Modo de tarea larga (`longTask.*`, apagado por defecto) — el trío para «sesiones de larga corrida»: medición de contexto, referencia de tarea, compresión de cola, más un panel flotante de sugerencias no bloqueante.**
  - **Uso de contexto (`store/context-usage.ts`)**: escucha el lado de entrada del `usage` oficial de `assistant/message` (input + lectura/escritura de caché), tomando semántica de **valor más reciente** (el lado de entrada de cada ronda ya contiene todo el historial, sin acumular); tras `compaction/summary` se pone a cero y se recuenta. Un Map puro en memoria por sesión — el primer mensaje assistant tras reiniciar lo puede reconstruir; persistirlo solo resucitaría muestras rancias.
  - **Referencia de todo (`store/todo-ref.ts` + `hooks/long-task.ts`)**: escucha el evento estructurado `todo/write` del huésped (una instantánea completa; los tipos del paquete no lo habían declarado hasta 0.2.0-rc.1, así que el plugin se autoaumenta vía declare module — el mismo precedente que el dsh-compaction de §E). **Solo sesiones de tarea larga**: la instantánea se vuelca en una ranura `todo` pinned (refresco gestionado `SlotStore.refreshByTitle` — escrituras repetidas del mismo sujeto deben actualizar en el sitio, si no dentro del tope ≤8 de ranuras se amontona un rastro de ranuras cerradas), inyectada de forma permanente vía slot-recall — tras la compresión expulsar el contexto viejo, la estrella polar de la tarea sigue ahí. A instantañas adyacentes se les hace una detección de deriva Jaccard literal (reescrituras de la misma instantánea no diluyen la señal); body ≤512 bytes, truncado explícito.
  - **Compresión de turnos de cola (endpoint `longtask-compress-tail` + `compressTailTurns`)**: destila inmediatamente a memoria vía `enqueue(force:true)` los últimos N turnos dentro de (línea de marca de compresión, última ronda capturada] — convierte la conversación de cola en memoria recuperable en el acto, sin esperar el umbral de destilación. La línea de marca (`SessionModeStore.lastTailCompressedTurn`) solo avanza, y pulsar repetido es naturalmente idempotente; la banda off es totalmente invisible; los datos viejos sin ancla solo se incluyen en la primera compresión (marca 0) — antes recoger de menos que revolver a destilar.
  - **Estado de sugerencia (`longtask-hint-get`) + bola flotante (`client/src/longtask-fab.ts`)**: un overlay vanilla estilo ego-browser (FAB + panel, arrastre / persistencia de posición / ajuste a la ventana), **la sugerencia no bloquea** — el halo de respiración se enciende solo cuando «la ocupación de contexto llega a `contextThresholdPct`» o «la deriva de todo llega a `driftThreshold`» y la tarea larga está apagada; dentro del panel: el conmutador de tarea larga (temporal, por sesión, **sin mode** — voltear el conmutador no resetea el nivel del usuario), las barras de progreso de ocupación/deriva, un botón de compresión de cola manual (solo usable con tarea larga activada), un recuento de tareas. Sondeo 2s ocupado / 5s ocioso, los fallos de RPC en silencio; el contrato de asientos no cambia (settings.section exactamente uno, el body singleton no ocupa ningún asiento).
  - **El `mode` de `session-mode-set` pasa a opcional**: obligatorio él o `longTask` — voltear solo el conmutador de tarea larga ya no obliga a enviar un nivel (los clientes viejos siempre enviaban mode, comportamiento igual). La respuesta `mode` vuelve al valor efectivamente en vigor.

## [0.19.0] — 2026-09-29

### Cambios

- **Adaptación a DSH 0.2.0 (compat/0.2.0)**: peerDependencies y engines.dsh (package.json + dsh.plugin.json) pasan en bloque a `>=0.2.0-rc.1 <0.2.1-0` (sustitución por un solo intervalo; la línea 0.1.7 sigue atendida por la rama compat/0.1.7); las 9 devDependencies dsh-* se fijan con precisión 0.1.1-rc.2 → 0.2.0-rc.1 y se añade la dependencia type-only `@deepseek-ai/dsh-compaction`. Adaptación a nivel de código a la deriva del API del host 0.2.0: el evento `agent/session-start` confluye en `agent/created` (los escuchas pasan a async para honrar el contrato serial); la lectura de eventos de sesión pasa de `session.events` a `session.snapshotEvents()` (el host marcó como obsoleta la lectura sincrónica integral, la cadena de degradación se conserva); stubs de test actualizados (semántica del offset del cursor de proyección).
- **Metadatos de publicación**: versión 0.18.4 → 0.19.0; publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0`; dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.18.4] — 2026-09-28

### Añadidos

- **Recuperación tras caída (§A)**: cuando el host caía a mitad de turno, ese turno de conversación antes se perdía para siempre con el búfer de captura en memoria (el suelo de arranque en frío del resume tiraba toda la historia). Ahora al resume el plugin concilia con el registro de eventos persistido por el host: el mayor turno ya escrito en L0 sirve de marca de agua para recuperar los turnos completos que le siguen (tope de 2 turnos; los turnos huérfanos de la caída los cierra el host con `turn/end{reason:'interrupted'}` — 98 casos encontrados en esta máquina). Idempotencia = marca de agua + comprobación de existencia turno por turno; si los servicios de lectura del host no están disponibles, degradación por peldaños (`sessionQuery.readSession` → `sessionPersistence.readFrom` → mantener el comportamiento actual + aviso de una sola vez), siempre fail-open y sin bloquear jamás el arranque de la sesión.
- **Censura de cargas útiles (§C, `capture.redactSecrets`, activada por defecto)**: en la frontera de escritura de la captura, 8 clases de secretos (claves PEM / cabeceras Authorization / Bearer y JWT / Cookie / formas de claves API de proveedores / correos / números largos ≥ 9 cifras sin fechas / IDs de alta entropía) se sustituyen por marcadores tipificados `[REDACTED:<KIND>]` — un solo punto de paso que cubre JSONL L0, SQLite L0, entradas de destilación y escrituras manuales `memory_add`/`memory_import` (las dos fronteras de escritura L1 comparten el mismo vocabulario). Los valores seguros (`example` / `$VAR` / `${{…}}` etc.) no se censuran; los marcadores conservan la semántica de categoría y siguen siendo alcanzables por la búsqueda. Atención: una vez activada, el texto L0 original queda cambiado para siempre (la reconstrucción no lo devuelve); `false` devuelve al texto en claro de un golpe.
- **Antidifusión de los prompts de destilación (§B)**: los seis prompts de destilación (extracción L1 ×3 / deduplicación L1 ×3 / escena L2 ×2 / perfil L3 ×2 / proyección del grafo / verificador) llevan todos una declaración general «frontera de contenido (antidifusión)» más la delimitación de los huecos de datos — el texto de conversación, el vaso de memorias existente, los textos completos de escenas etc. incrustados en los prompts son datos, no instrucciones, para que un texto de aire imperativo traído por la conversación ya no pueda secuestrar la destilación, la deduplicación ni el arbitraje. Vocabularios de decisión y contratos de salida sin cambios al bit.

### Mejoras

- **Recibo de inyección (§D)**: la inyección del recuerdo ya no se marca como vista en el instante del regreso; se pasa al esquema «pending → recibo del registro» en dos fases — el `dedupe.mark` ocurre solo cuando el host escribe de verdad el mensaje de inyección en el registro de sesión (`user/message` firmado `plugin:memory` con id estable). Las inyecciones sobreescritas o canceladas ya no sofocan a una memoria por error (se puede volver a inyectar en el siguiente turno); sin recibo en 5 minutos se degrada a la marca normal (para que un fallo de la cadena de recibos no rompa la deduplicación), lo no confirmado se descarta.
- **Reinyección dirigida tras compresión (§E)**: tras `compaction/end` (sin error), el siguiente turno de la sesión hace un recuerdo reforzado y dirigido — se salta la supresión por deduplicación (la compresión ya expulsó del contexto las viejas inyecciones), el perfil se vuelve a inyectar enseguida, el registro de ocupación vuelve a cero; consumir es borrar. El viejo reinicio íntegro de sesión en compact/clear se conserva como camino de repliegue; los dos caminos son idempotentes.
- **Trazado estructurado (§F, `trace.*`)**: los eventos de recuerdo y destilación se escriben en JSONL diario (`<dataDir>/trace/`, retención por defecto 14 días, paro de escritura a 5 MB/día + marcador). El evento de recuerdo contiene la huella de la query (por defecto solo metadatos: longitud + sha256, `trace.captureContent` guarda el original ≤ 200 caracteres), los id de aciertos/inyecciones, las puntuaciones, las duraciones y cuatro desenlaces (injected/suppressed/timeout/off); el evento de destilación contiene runId, el agregado de decisiones a seis valores (misma fuente que `l1_receipts`, auditable en cruz), las duraciones y el desenlace. Nuevo endpoint `dsh-memory/trace-tail`; la pestaña «Registros» de la página de ajustes recibe una conmutación entre tres fuentes de datos: registro del sistema / traza del recuerdo / traza de la destilación.

## [0.18.2] — 2026-09-27

### Corregidos

- **Adaptación a la firma del formato de sesión v4 (host ≥ 0.1.7-rc.1)**: las dos inyecciones de recuerdo de memoria (`hooks/recall.ts` para el recuerdo entre sesiones, `hooks/slot-recall.ts` para la inyección permanente de ranuras) ya no usan la vieja firma `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }` que el host v4 rechaza (desencadenaba un `SessionFormatError` y el fallo del turno entero — la fuente de los «errores al llamar a la memoria»); se pasa a la firma producer-owned `{ kind: 'plugin:memory', form: 'recall' }`. `form`, el contenido y los tiempos de las inyecciones no cambian. Base probatoria: la `source()` de `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` solo comprueba que kind no esté vacío y ≠ `'plugin'`, sin validar los campos de acompañamiento.
- **Compatibilidad con doble forma en lectura**: el criterio de firma `isOwnRecallSource`, usado para estimar la cuota de recuerdo, acepta a la vez la nueva firma y las viejas líneas v3 — corregir solo la escritura habría hecho caer en silencio a cero la «cuota de recuerdo de memoria» del panel de ocupación (sin excepción, sin error). `MessageSourceMap` registra `plugin:memory` por module augmentation (la map de dsh-llm 0.1.7 es `user|model|tool|'system-prompt'`, sin portal de socorro plugin, ampliable por fusión por productor).
- **Adaptación nativa al tool-result v4 (N1)**: la lectura de textos probatorios de `store/evidence-source.ts` recibe una rama nativa (mensajes de primera clase `role:'tool'` en v4: content directamente a bloques text/reasoning, `isError` en la raíz del mensaje; el `assertBlock` del host rechaza tajantemente los viejos bloques envoltorio `tool-result`), el viejo camino de bajada por bloques se conserva como compatibilidad histórica — si no, los textos probatorios quedarían silenciosamente vacíos bajo v4. La guardia `isError` de `projection/slots.ts` pasa en el mismo acto a la nativa.

## [Sin publicar]

### Añadidos

- **Ranuras activas (Active Slot) — sacar «las convenciones que deben valer en cada jugada» del recuerdo semántico, para hacer de ellas un contexto permanente que dura de sesión a sesión.** El origen es un fracaso real: la regla general de acceso a la red (subida por la oficial, bajada por el espejo) estaba escrita en la memoria, pero en el turno siguiente **no fue recordada**, y la vieja mala costumbre siguió corriendo. El recuerdo semántico es probabilístico, y precisamente este tipo de reglas exige determinismo — de ahí un canal mecánico reservado para ellas.
  - **Almacenamiento**: `<dataDir>/slots.json`, separado de `state.json` (las ranuras son retoques pequeños de alta frecuencia; no se puede arrastrar la escritura atómica del checkpoint a su ritmo), reutilizando el `atomicWriteJson` de `util/io.ts`; en memoria solo se cambia en el sitio, `list()/open()/alwaysOn()` devuelven siempre copias (lección de las referencias vivas de `StateStore.reset()`).
  - **Tríada de herramientas**: `memory_slot_write` / `memory_slot_list` / `memory_slot_close`. Escribir y cerrar están sujetos a la barrera de altos privilegios `live.memoryMutate` (apagada por defecto) — cambiar de estado es gestión de riesgo estricta; la lectura está sujeta al gating de la modalidad de sesión, la misma semántica que `memory_search`. El nuevo registrador vive en su propio archivo, cero intrusiones en `tools/index.ts` (1156 líneas).
  - **Inyección permanente**: `hooks/slot-recall.ts` registra su propio `agent/pre-step` (prepend en cascada), combinable con el `recall.ts` existente (el orden de las dos inyecciones está clavado con tests). Las ranuras `pinned && open` se ordenan por priority descendente y se recortan al presupuesto de bytes; más allá, se señala expresamente con `… y N más` y se da la vía para encontrarlos — **el recorte nunca es mudo**. `validUntil` se convierte en `expired` por una liquidación mecánica antes de inyectar (pura comparación de marcas de tiempo, sin introducir ningún LLM), si no, la «vigencia» habría sido solo adorno.
  - **Proyección en el servidor `memorySlots`**: se registra vía `ctx.inject(['sessionProjections'])` — si el host no tiene ese servicio, **se renuncia en silencio al registro**, en lugar de hacer fracasar la carga de toda la línea de perfil. El closure de `apply` cierra sobre `SlotStore` y juzga la suciedad con `revision()`: **solo se reconstruye en `tool/result` (resuelto, sin error) y con la revisión cambiada** (`tool/call` comete antes de que `execute()` modifique el store — plegar por call leería rancio); los eventos sin relación devuelven **la misma referencia**; `view` mantiene la estabilidad de referencias con `WeakMap` y **no contiene el body** (juzgar y generar son ortogonales, el texto se recupera a demanda). Este giro no trae ni una línea de código cliente: la presentación queda para el briefing del giro siguiente.
  - **Esquema sin nueva dependencia**: `stateSchema` / `viewSchema` implementan `parse` por sí mismas (el runtime del registro solo llama a este método); el estado legal **se devuelve tal cual, la misma referencia**, el ilegal lanza; no entra zod (`package.json` y lockfile fuera de la lista blanca de cambios de este giro).
  - Límites: ≤ 8 ranuras (configurable) / permanente ≤ 2048 bytes / body ≤ 512 / título ≤ 60.
- **Anclas de procedencia (R7) — la memoria ahora recupera su **posición real** en la sesión.** Antes la cadena de trazabilidad estaba rota: L1 llevaba `source_message_ids`, pero eran **ids de mensajes L0** (`msg_<epoch_ms>_<hex>`), y la tabla L0 no tenía columnas `turn`/`step`; además esa lista de ids **no se escribía en absoluto en la base de búsqueda** (el lado de escritura solo tomaba `metadata`, el campo caía en silencio). Resultado: **ninguna memoria podía localizarse sobre su original**.
  - `l0_conversations` recibe las columnas `turn`/`step` (`ALTER TABLE` idempotente; las filas viejas quedan NULL = sin ancla, **nunca adivinar a posteriori**), más un índice `(session_id, turn)`.
  - El lado de captura recibe un fold de `step/start`: `user/message` **no lleva** `step` en la carga del núcleo, se deduce del `step/start` del mismo turno; `assistant/message` usa el `{turn, step}` que trae el evento. **Los mensajes anteriores al primer `step/start` dejan el step vacío** — donde faltan coordenadas no se inventan, es la línea roja.
  - El ancla alberga en la clave reservada `dsh_source_anchors` de `metadata_json` (la UI la muestra como `t12 s3`). Ninguna columna añadida, ningún contrato en disco tocado. **Ambos caminos de escritura — creación y «fusión/actualización» — llevan el ancla** — si no, una sola fusión bastaría para perder las coordenadas, y la fusión es la acción más frecuente de las sesiones largas.
  - Nueva interfaz de lectura del host `MemoryDb.l0ByAnchor(sessionId, turn, step?)`: tomar los mensajes L0 **por coordenadas** (no por tiempo); es la entrada única del futuro «lector de pruebas».
- **El panel de registros muestra el ancla de procedencia** (hasta ahora esa línea no mostraba nunca más que un «-»).
- **Lector de pruebas (R1) — devolver a las anclas el texto original de la sesión.** El texto original va por el **`ctx.sessionQuery` del núcleo** en línea directa (`readSession` / `listEvents`), sin esperar un endpoint HTTP de un plugin de indexación externo: este plugin es un plugin host, tiene el `ctx` ya en la mano, lo que ahorra una frontera de proceso y un punto de fallo. Este giro entrega la **capa de funciones puras** (cableado y llamadas reales en máquina: entradas siguientes).
  - **Se prueban ambas formas del id de sesión**: en el índice hay `session_id` con el prefijo `session-` y otros en uuid puro; probar una sola **deja escapar silenciosamente 124 sesiones** (sin errores — simplemente nunca se encuentran).
  - `foldEventAnchors` reutiliza en lectura **la misma regla de fold que la captura**, garantizando que las coordenadas escritas y leídas hablan la misma semántica.
  - **Proyección fiel**: sin `stripCodeBlocks`, sin recorte por longitud, sin criba «merece la pena recordarlo» — **la captura puede dejar caer algo para ahorrar tokens, la recolección de pruebas no**. El único filtro conservado: «el contexto inyectado por el plugin no cuenta como palabra del usuario».
  - **Fallos clasificables** (el corazón de esta entrada): `no-service` / `no-anchor` / `session-unreadable` / `anchor-not-found` / `timeout` / `error`. La distinción de los cuatro primeros es imprescindible — tomar «no se lee» por «nunca se habló» llevaría a juzgar sistemáticamente mal las memorias de las sesiones archivadas.

- **Retirada de memorias (borrado lógico) y ciclo cerrado de limpieza: borrar ya no significa perder datos.** Antes «borrar» era **borrado físico** — tras un paso en falso solo quedaba pescar a mano en las fuentes de verdad `records/*.jsonl`. Ahora el borrado tiene dos grados, **el reversible es el predeterminado**, el irreversible hay que pedirlo expresamente y trae consigo su propio export.
  - **Retirada (borrado lógico)**: la fila de la tabla principal se conserva + `valid_to` se cierra + se escribe un marcador de sustitución (clave reservada `dsh_superseded` de `metadata`, con instante / motivo / veredicto / id de la pareja en conflicto); solo se quitan las filas `l1_fts` y `l1_vec`. **El SQL del lado de búsqueda no se movió una palabra** — cero deriva de consultas. Las tres vías de retirada (condena en el arbitraje / sustitución por deduplicación `update`·`merge` / borrado manual) **comparten el mismo primitivo**, si no, tarde o temprano aparecería la incoherencia «alguna vía todavía borra a lo duro» — incoherencia que se descubriría solo en el momento del paso en falso.
  - **Endpoints 33 → 38**: `records-retired` (lista de los retirados) / `records-restore` (recuperación) / `cleanup-retired` (limpieza física) / `snapshots-list` (lista de instantáneas) / `snapshot-restore` (reinyección desde instantánea). Las tres listas (tabla de correspondencia de `contract.ts` / lista blanca `MEMORY_ENDPOINTS` de `stats.ts` / `case` de distribución) y la aserción del total de endpoints se actualizan a la vez — olvidando una sola de las cuatro, el endpoint respondería 404 a perpetuidad, mientras el `catch` del `rpc` del cliente se tragaría la excepción en silencio y el panel desaparecería de un bloque.
  - **`memory_delete` retira por defecto solo 1 entrada** (antes 3) y recibe una vía **exacta** por `ids` (saltándose el emparejamiento semántico). La vieja implementación borraba por lotes con el top-N semántico y en la práctica **borró por error dos memorias verdaderas sin relación** — la puntería del borrado la debe garantizar el ID exacto, no el parecido.
  - **La limpieza física corre por defecto en seco**: sin `dryRun` se entiende `true`. Incluso con ejecución expresa, primero se toma una **instantánea íntegra** de la base y se **verifica por hash del contenido**; si no cuadra, parón y ni una línea borrada. Para ello, `deleteL1Batch` se condensa en un **único llamante** (`exportThenPurge`), clavado por un test de guardia sobre el fuente — «no existe un camino de borrado físico que rodee el export» pasa a ser un hecho estructural, no una promesa.
  - **El billete de vuelta se añade**: `restoreL1Snapshot` hasta ahora lo **llamaban solo los tests** — el principio «primero el export, después la limpieza» se cumplía a medias: el export estaba, la salida de reinyección no; en caso de avería quedaba solo descifrar a mano `l1-records.json`. Ahora llegan `snapshots-list` / `snapshot-restore`: aceptan solo **nombres de directorio** de instantánea (rutas y `..` rechazados), en seco por defecto, y reportan honestamente `stillRetired`. Esta entrada es necesaria: la limpieza solo limpia las entradas **ya retiradas**, y la instantánea se toma **antes** del borrado — por eso todo lo recuperado lleva el marcador de retirada — **vuelto a la tabla principal ≠ vuelto al recuerdo**; sin decirlo, uno creería la restauración terminada. Para un rollback verdadero en un paso: `unretire: true` (reutiliza el `restore` existente, sin nuevo camino de escritura).
  - **Panel**: la página de registros recibe la zona «Retirados (recuperables)» (plegada por defecto, se carga solo al abrir — no debe frenar la navegación ordinaria); el texto de confirmación del borrado ahora dice expresamente «recuperable». **La limpieza física no tiene deliberadamente entrada en el panel** — una acción irreversible queda solo en RPC / vía modelo.
- **§C Congelación de contradicciones: también se congelan las contradicciones dentro del mismo lote (arreglado «la frase propia del modelo se le rechazaba en la puerta»).** La pesquisa halló que el punto ③ de `validateConflictPair` exigía de modo rígido que «la parte contraria fuera un registro conocido del vaso de candidatos», pero los id de las nuevas memorias del mismo lote no están ahí (nacen en ese turno y aún no han entrado en base). Así, en el caso más típico de «la máquina no puede decidir» — dos memorias nuevas del mismo turno se contradicen — incluso una `conflict` emitida correctamente por el modelo recaía necesariamente en `store`. Prueba: el modelo emite en 7/7 de los casos, pero ese salto nunca llegaba a la base (`conflict_pending` 0 filas desde su creación, `l1_receipts` 0 recibos `conflict`, frente a `store 381 / merge 204 / update 172 / skip 7`). Remedio: `validateConflictPair` recibe el opcional `batchIds` (ausente = comportamiento viejo), manteniendo el requisito «exactamente una de las partes es la memoria presente» para garantizar la unicidad del apareamiento; y una barandilla para la cola llena — **cuando el perdedor pertenece a las memorias nuevas del turno, no hay cierre automático**; si no, los productos recién extraídos saldrían enseguida de escena sin que nadie se enterara: entonces no se aparca y la entrada en base sigue su curso.

- **§C La congelación de contradicciones ahora entiende «los tres ejes de tiempo» — una contradicción de contenido con anterioridad en el tiempo ya no va invariablemente al humano.** Un registro de memoria trae de serie tres ejes de tiempo no sustituibles (instante de registro `createdAt/updatedAt`, validez fáctica `validFrom/validTo`, persistencia `persistence`), pero la detección de conflictos usaba solo el instante de registro: al dictar `conflict`, el detector no veía ni validez ni persistencia y tomaba a menudo por un caso humano «un hecho viejo desplazado por uno nuevo»; y el panel de arbitraje solo mostraba los textos de ambas partes, sin comparación de validez — un juicio a ciegas. Este giro conecta los tres ejes a ambos extremos de la congelación:
  - **Lado de detección**: el vaso unificado de candidatos transmite al detector, **con la congelación activada**, `valid_from_ms` / `valid_to_ms` / `persistence` de cada memoria; la cláusula de la acción `conflict` recibe una «ayuda de juicio por los tres ejes» — ante contradicción de contenido, comparar primero validez/persistencia; si una parte ya está vencida o es claramente más reciente, orientar a `update`/`merge` en vez de `conflict`. **Las tres claves y la cláusula están todas bajo el gating de `conflictFreeze`**: en estado apagado el prompt de usuario es **byte a byte idéntico** al previo a la actualización (ver «Corregidos» abajo y [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md)).
  - **Lado de arbitraje**: `ConflictPairView` recibe los campos opcionales de ejes `winner_*` / `loser_*` (retrocompatibles); la lista a arbitrar y el render añaden a cada pareja la comparación «validez desde/hasta, persistencia», para ver de un vistazo quién es más reciente, quién ya está vencido.
  - La máquina **sigue sin decidir por sí sola**: los tres ejes son solo hechos de apoyo; la conclusión final la sigue escribiendo el humano (o la válvula de seguridad: vencimiento / cola llena) — los valores de `ConflictResolution` no cambian.

- **§C Tres clases de conflicto + agrupación por claim + rastro del descarte (Fase 3-4).** El conflicto ya no se reduce a una sola «contradicción dura» — el LLM puede ahora dictaminar `hard` (hechos mutuamente excluyentes), `conditional` (contradicción solo con premisas distintas), `supersession` (lo nuevo reemplaza a lo viejo). El panel muestra por segmentos de las tres clases, cada una con su título y explicación propios; el botón `defer` permite «visto pero aún sin decidir» (reinicia el vencimiento, acumula las releituras). La columna `claim_key` permite marcar varias parejas de conflicto sobre el mismo tema, y el panel agrupa por ella. Las decisiones de conflicto ilegítimas y descartadas se consultan con la herramienta `memory_conflicts_rejected` y el endpoint `dsh-memory/conflicts-rejected`.
  - `conflict_pending` recibe dos columnas `conflict_type` / `claim_key` (migración `ALTER TABLE` idempotente).
  - El recuento de cuota cuenta solo `hard`: `pendingHardTotal` filtra por tipo; `conditional` / `supersession` no gastan cuota.
  - Hash de proyección congelado: la proyección a 7 campos `projectConflictsForHash` excluye las columnas nuevas, la verificación de instantáneas existentes no cambia.
  - Panel: `ConflictsTab` con segmentación en tres clases + botón defer + textos de los tres ejes + contador de releituras + muestra de la clave de claim.

### Corregidos

- **En estado apagado, al prompt se le colaban a escondidas tres campos de los ejes (tocados los despliegues con valores por defecto).** La primera versión inyectaba `valid_from_ms` / `valid_to_ms` / `persistence` **incondicionalmente** en el vaso de candidatos, mientras esa llamada LLM solo leía el interruptor para el system prompt ⇒ con `conflictFreeze=false` (el predeterminado de los despliegues), el modelo veía por cada candidato 3 claves de más **sin ninguna cláusula que las explicara**: tokens gastados y una entrada cambiada. Las tres claves están ahora bajo el gating de `conflictFreeze`, el estado apagado produce un prompt de usuario **byte a byte idéntico** al previo a la actualización; el criterio sube al mismo tiempo de «no contiene tal subcadena» a **ancla golden sha1 + verificación inversa** (rompe el gating y el test tiene que enrojecer).
- **El panel decía «congelación de contradicciones no activada», mientras el interruptor estaba claramente encendido.** Los endpoints `conflicts` / `conflict-resolve` leían la **configuración estática del despliegue** `cfg.conflictFreeze.enabled`, mientras el panel escribía en los **ajustes de tiempo de ejecución** (live). El predeterminado del despliegue es siempre `false`: el interruptor estaba encendido, en `settings.yaml` figuraba `true`, y la página seguía anunciando lo apagado. Cambio a `effectiveCfg(cfg, live)` — la misma resolución que la canalización de deduplicación; el interruptor tiene **una sola** fuente de verdad, lector y escritor tienen que mirar el mismo estado, si no se obtiene «la lista dice encendido, el arbitraje dice apagado», testimonios que se contradicen.
- **`dsh-memory/embedding-reindex` declarado pero respondiendo 404 a perpetuidad.** El endpoint estaba en el contrato, pero faltaba a la vez en la lista blanca `MEMORY_ENDPOINTS` y en el `case` de distribución; mientras tanto, `startReindex()` era **código muerto** — el bloque «índice vectorial» de la página de ajustes ofrecía por eso solo «Cancelar», nunca «Iniciar». Lista blanca + `case` + test añadidos.
- **`UiRecord.sourceMessageIds` era un campo muerto.** Leía de `l1_records` una **columna que nunca existió**, recaía siempre en `[]`, y la línea de procedencia del panel **nunca se llegó a dibujar**. Sustituido por `sourceAnchors`, que lee datos de verdad.

## [0.17.0-dsh0.1.7.1] — 2026-09-25

> Primera publicación de la línea de compatibilidad con el host **0.1.7** (dist-tag `dsh-0.1.7`, basada en main @ 85d9b05). **Solo para hosts ≥ 0.1.7-rc.1**;
> los hosts 0.1.5 / 0.1.6 deberían seguir usando la línea de versiones del tag `dsh-0.1.5`. Contenido = main completo + la siguiente adaptación.

### Cambios

- **Los interruptores de ejecución se mudan a una sección volatile del Config (superficie declarativa de ajustes de 0.1.7).** El host 0.1.7 eliminó las dos generaciones de API de registro imperativo (`settings.register` / `installSection`); los interruptores de ejecución (general/captura/destilación/recuerdo, cadenas de enrutamiento de destilación, sobreescrituras del embedding remoto, barrera de escritura-borrado — 20 claves) los porta ahora una sección entera `.volatile()` sobre `memorySchema.live`: el host proyecta automáticamente los campos volátiles en un formulario de ajustes, y los cambios de ejecución pasan por `ctx.settings.update` → configEditor → patch del perfil → commit volatile-only del loader (sin remontar el plugin). El contrato `LiveSettingsHandle` no cambia, RPC y todos los consumidores quedan intactos. **Página de ajustes propia a bordo → el formulario autogenerado del host está apagado** (`suppressAutoSettingsForm`).
- **⚠️ Los valores antiguos de ajustes no migran solos**: la sección `dsh-memory` del viejo `settings.yaml` portaba claves planas de primer nivel, incompatibles con los nuevos caminos `live.*` (y su booleano `conflictFreeze` choca con la sección objeto homónima del nuevo Config), por lo que el importador del host rechaza la sección entera. Tras la actualización, reescribe a mano los valores viejos en el patch del perfil como `- id: dsh-memory / config: { live: {…} }` (nombres de claves idénticos al viejo namespace, solo un nivel `live.` más profundo).
- devDeps subidas al stack 0.1.7 (cordis 4.0.4 / schemastery 3.18.4 / cordis-plugin-loader 1.0.5), sin enviarse a los consumidores.

### Corregidos

- **Regresión de pérdida silenciosa de la primera escritura**: los archivos de bloqueo se creaban antes de escribir; si el directorio padre del objetivo aún no existía, `open('wx')` fallaba con ENOENT y los stores lo tragaban como warn → primera escritura perdida en silencio. `rmwJson` ahora hace `ensureDir` antes de coger el bloqueo (incluido con las correcciones de la línea main).
- Contiene además todo lo de la línea main: endurecimiento de la capa de archivos (escrituras atómicas / clasificación en lectura / versión fail-closed / bloqueos de archivos / seguridad de rutas — ver las entradas [0.16.1] y Sin publicar).

## [0.16.1] — 2026-09-24

### Añadidos

- **«Criba de retirados» en el panel de registros**: los registros de borrado lógico por diseño no se esconden (son recuperables), pero mezclados con los activos eran difíciles de distinguir — la fila de herramientas de la lista recibe ahora un filtro de tres estados «**Todos / solo activos / solo retirados**». El `listL1` del backend recibe el mismo filtro de tres estados, el mismo criterio (por defecto todo; instantáneas/reconstrucción intactos; el criterio de `retired:true` y el de `listRetiredL1` son el mismo, ambas vistas muestran las mismas filas); contrato `ListRecordsRequest.retired?: boolean`. La criba solo actúa en el camino de navegación — la búsqueda por palabra clave cubre solo la cara de búsqueda, donde los registros retirados por lo demás no están. «Cargar más» y el refresco automático tras borrar/restaurar conservan el estado de la criba vigente.

### Corregidos

- **Tras confirmar «borrar memoria», el panel parecía ignorar la petición — el estado de retirada no llegaba a la UI.** El borrado lógico (retire) siempre funcionó bien del lado del servidor (`valid_to` cerrado + sacado de la cara de búsqueda + recuperable), pero por diseño la lista activa **conserva** los registros retirados (el test `l1-retire` clava «el camino de navegación del panel no esconde los registros retirados»), mientras el contrato `UiRecord` no tenía ningún campo «ya retirado», las filas de la lista activa no tenían ninguna diferencia visual y la zona «retirados» estaba plegada por defecto — tras la confirmación el usuario veía **un registro idéntico en todo** y concluía naturalmente que «el borrado no surtió efecto».
  - El contrato recibe `UiRecord.retired` / `retiredReason`: derivados por `hitToUiRecord` de `valid_to` + marcador de sustitución, transmitidos uniformemente por la lista activa y los resultados de búsqueda.
  - La lista activa dibuja los registros retirados con un **distintivo «retirado · motivo» + toda la carta en gris**, y el botón en línea cambia de «✕ Borrar» a «Restaurar» (vía `records-restore`, con refresco automático tras el éxito) — en el instante del borrado la interfaz cambia al instante, y la confusión del segundo clic (no-op idempotente) desaparece.
  - Nuevo `tests/ui-retired-flag.test.ts` que clava la correspondencia (activo / retirado a mano / retirado por sustitución / forma sin `validTo`).

## [0.16.0] — 2026-09-24

### Corregidos

- **Toda la cadena de marcado Wing del recalibrado / relleno a un clic era inservible**: el prompt pedía al modelo devolver `{"id":…,"wing":…}`, pero el parsing leía `item.hall` → nunca obtenía nada → todo el lote descartado en silencio **(medido en la práctica: `wingLabeled=0 / tagged=0 / llmSkipped=60`, mientras el log mostraba el LLM en pleno éxito)**. Es el **3er daño colateral de la misma casta** desde el cambio de nombre hall→Wing (los dos primeros: `cfg.hall`, el `hall` de session-modes) — los nombres de campos JSON en un prompt pertenecen al **protocolo de cable** y no deben seguir los cambios de nombre de los rótulos de la UI. El parsing ahora lee `wing` con validación por enumeración; **todo descarte debe dejar rastro** (una entrada warn por emparejamiento de id fallido, otra por valor ilegítimo), y el `catch` muerto jamás disparado se elimina.
- **`embedding-state-get` baja de 2,5–3,1 s a los milisegundos.** Ejecutaba a cada llamada 6 COUNT en el sitio, dos de ellos en la forma `l1_records LEFT JOIN l1_vec … IS NULL` — `l1_vec` es una **tabla virtual vec0 (1024 dimensiones)** que con predicados ordinarios degenera en sondeo fila a fila. Sustituido por una resta «total − ya incorporados − skip» (medido: L1 55 ms → 0 ms, L0 371 ms → 3 ms), más una **caché TTL escalonada** (1 s si ocupado / 30 s en reposo + invalidación expresa al terminar reconstrucción/conmutación/relleno).
- **La parte mecánica del recalibrado ya no carga todo de un bocado** con `l1.all()`. Cambio a paginación por cursor + solo las columnas `id/type/metadata` (`getAllL1Lite`), cediendo la mano tras cada lote de 200; la reescritura va por `patchL1Metadata` (**toca solo el metadata, jamás el texto**, clavado con test).

### Añadidos

- **Capa Room: clasificación autocreciente por etiquetas**. En las cinco capas de MemPalace, Room está debajo de los Wing/hall cognitivos y se **deriva dinámicamente** de `metadata.tags` (agregado `json_each`, cero esquema, cero registro) — en cuanto una etiqueta nueva entra en base, se vuelve un Room nuevo. Nuevo endpoint `rooms-get` y bloque de clasificación Room en el panel de registros (un clic filtra por esa etiqueta; `list-records` recibe un canal de filtro por `tag`). Contado en esta máquina: **78 Room** (agregado en 2 ms).
- **Módulo de validación compartido `src/metadata-validators.ts`**: `isWingId` / `isCognitiveHall` / `isTag` / `normTags` centralizados en un solo lugar. Antes el lado Wing estaba **totalmente sin validación** (cualquier cadena no vacía podía escribirse en `metadata.hall`), mientras el lado de los hall cognitivos tenía un estricto `isCognitiveHall()` — esa asimetría de enumeraciones era un agujero en la integridad de los datos.
- **Aislamiento de worker para el procesamiento de fondo (porción estrecha de B)**: se extrae una frontera `MemoryBackend`, los accesos SQLite del procesamiento por lotes de fondo (rumiación/relleno/recalibrado) se mudan a `worker_threads` y dejan de ocupar la event loop principal del host; si el worker no arranca, regreso automático al proceso con warn (**el fracaso del aislamiento jamás debe dejar sin efecto el procesamiento de fondo**). Los caminos calientes (recuerdo/captura) no se mueven una línea — consultan la base en cada turno; hacerlos hilos les haría pagar el peaje del IPC.
- **Progreso de lotes distinguible por segmento**: inspección mecánica / relleno de Wing / destilación de etiquetas reciben cada uno su propio label y su propio progreso de lote (antes `sub` solo tenía valor en la fase LLM; durante las 1439 reescrituras de la fase mecánica el panel quedaba totalmente vacío).

### Cambios

- La reescritura del metadata del recalibrado pasa de `l1.upsert` a `patchMetadata`. **Tocar solo el metadata en principio no debería haber recalculado el embedding** — antes cada reescritura de registro lanzaba un embedding, un solo recalibrado podía derrochar hasta 900 llamadas de embedding.


## [0.12.0] — 2026-09-17

### Añadidos

- **Reconstrucción manual del índice vectorial (endpoint `dsh-memory/embedding-reindex` + bloque «índice vectorial» en la página de ajustes)**. Antes la reconstrucción tenía solo dos caminos: la cadena de detección de cambios de `db.init` al arrancar, y el relleno de lo faltante por el backfill periódico — **el usuario no tenía ninguna entrada manual**. En la página de ajustes solo se veía «Cancelar» (y eso solo durante una reconstrucción en curso), nunca «Iniciar», ni cuántos estaban ya incorporados o cuántos faltaban. Ahora cerrado:
  - **Cara de endpoints 31 → 32**. Nuevo `EmbeddingReindexStartResponse` (`{accepted:true}`), **retorno al aceptarse, el progreso no pasa por aquí** — el cliente sigue sondeando el campo `reindex` de `embedding-state-get`. Dos semánticas de progreso que se contradecían eran un accidente en espera: deliberadamente solo se deja una. Las tres listas (tabla de correspondencia de `contract.ts` / lista blanca `MEMORY_ENDPOINTS` de `stats.ts` / `case` de distribución) y la aserción del total de endpoints se actualizan juntas — saltándose una sola de estas cuatro, el endpoint responde 404 a perpetuidad, mientras el `catch` del `rpc` del cliente se traga la excepción en silencio y el panel desaparece de un bloque.
  - **`EmbeddingStateView` recibe `vectors`**: para L1 / L0 por separado `embedded` / `total` / `missing` / `skipped`. De ahí sale «X incorporados / Y en total». El **centinela `-1` de la capa db pasa tal cual** — «la capacidad vectorial no está disponible» y «no se ha incorporado ni una» deben ser en superficie dos frases distintas; plegadas en un solo número, el usuario iría a pulsar un botón que nunca responderá.

### Corregidos

- **Rechazar las peticiones de reconstrucción «aceptadas pero que nunca correrán»**. La primera línea de `L1Store.reindex` / `L0Store.reindex` **cortocircuitaba en silencio** a `0/0/0` cuando la capacidad vectorial no estaba lista. Sin umbral a la entrada, la UI habría mostrado «reconstrucción terminada, cero por rellenar» — mientras la verdad es que **jamás empezó**. Esta trampa estaba comentada ya en `src/index.ts:240`, pero eso cubría solo la cadena de arranque; la entrada manual era una brecha nueva. `startReindex()` lleva ahora los cinco umbrales por delante, cada uno con un texto **accionable**: plugin desinstalado / reconstrucción ya en curso / ocupada la conmutación de fuente de embeddings / **fuente de embeddings apagada** (`currentInfo` vacío) / **servicio de embeddings no listo** («primero activar» y «esperar un poco más» son dos frases distintas, no pueden fundirse en una). Para ello los dos stores reciben un accesor `vectorsReady()` — el `helper` es privado, desde fuera nadie podía preguntar.
- **El stub `db` de `embedding-subsystem.test.ts` estaba incompleto.** Solo tenía `swapProvider` / `markEmbeddingSynced` y esquivaba la comprobación de tipos con `as never`, por lo que nunca fue descubierto; en cuanto `snapshot()` empezó a añadir los recuentos vectoriales, explotó (`getVecSkipSet is not a function`). **Completar el stub en lugar de hacer `vectorCounts` defensivo**: la firma de tipos declara un `MemoryDb` completo; tragarse los métodos ausentes esconde también los verdaderos errores de cableado.

### Pruebas

- 5 casos nuevos: rechazo con el estado apagado / rechazo si no está listo / aceptación y pilotaje de L1+L0 con rechazo inmediato a una segunda petición paralela / rechazo tras la desinstalación / criterios de recuento de `snapshot`. **Cada camino de rechazo afirma a la vez «excepción lanzada» y «cero llamadas aguas abajo»** — afirmando solo la excepción, una implementación que «llamara primero aguas abajo y luego lanzara» pasaría igualmente.
- **Contra-prueba**: quitada temporalmente la guardia de preparación, `capacidad vectorial no lista → rechazo, no mentir «aceptado»` enrojece de verdad (`expected [Function] to throw an error`), y vuelve a verde al restaurarla.
- Total **39 archivos / 403 casos** en verde; `typecheck` (tres tsconfig), `build`, `smoke` igualmente en verde.

## [0.11.0] — 2026-09-13

### Compatibilidad (adaptada según la documentación del framework de plugins de DSH)

- **Compatibilidad multiversión del registro de ajustes (0.1.1-rc.2 ~ 0.1.5-rc.2)**. `src/settings.ts` **importaba como valor** `settingsNamespace()` de `@deepseek-ai/dsh-settings`, un símbolo eliminado desde v0.1.3+ — en un host 0.1.3+, ya la carga del módulo lanzaba `Failed to load plugins` y arrastraba consigo todo el árbol de plugins. Ahora:
  - el namespace pasa a ser el literal de cadena `'dsh-memory'` (la mitad navegador solo mira la cadena cruda, equivalente entre hosts viejos y nuevos); solo queda el import de tipos (se borra en la compilación, cero riesgo al cargar);
  - el registro pasa por tres ramas de ejecución: prioridad a `settings.register()` (presente en todas las versiones objetivo, devuelve un scope get/watch/update, los interruptores live y las escrituras de UI van todos por ahí); repliegue al puente `settings.installSection()` (superficie de servicio v0.1.2+, solo si falta register; las escrituras de ejecución lanzan expresamente un error de negocio); sin ninguno de los dos, degradación a siempre activado — la regla de hierro «ajustes ausentes jamás deben derribar el host» queda intocada;
  - `SettingsScope` pasa a ser un tipo estructural local, sin dependencia alguna de los exports de tipos del paquete.
- **Nuevo `dsh.plugin.json`** (manifiesto de descubrimiento DSH: id / engines.dsh `>=0.1.1-rc.2 <0.2.0-0` / components apuntan a `dist/`), alineado con la estructura estándar de `dsh-plugin-template`.
- **`@deepseek-ai/dsh-*` pasan a peerDependencies opcionales con intervalos relajados** (`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`), `@deepseek-ai/cordis` sigue siendo obligatoria — alineado con la exigencia B.3 de la presentación a awesome-dsh-plugin.
- **Nuevo `screenshots.json`** (8 capturas, referencian `assets/img/`), la carta de presentación puede mostrarlas.

### Cambios

- `package.json` `version` sube a 0.11.0; npm `files` recibe `dsh.plugin.json` (`screenshots.json`, por la convención de detección de awesome-dsh-plugin, solo vive en el repositorio git, no entra en el paquete npm).

### Pendiente de prueba real

- En v0.1.5-rc.2, la semántica de las ranuras `conversation.input.left` / `settings.section` y de `session.surface.nodes` de Session V3 (estimación de ocupación) aún no está probada sobre el terreno; ver la matriz de compatibilidad en el README.

## [Sin publicar]

> 📘 **Manual de trampas y remedios**: las trampas en las que de verdad se tropezó en este giro y los dos anteriores, y las direcciones tomadas por error, quedan depositadas de modo sistemático en
> [`ENGINEERING-NOTES.md`](./ENGINEERING-NOTES.md) (una página de consulta rápida + por entrada «síntoma / causa raíz / práctica correcta / cómo verificar»
> + lista de verificación antes de la entrega). Entre otras: `nullable` que derrumba todo el árbol de plugins, deps no inyectadas, ocultadas por un ramal de repliegue,
> parseadores duplicados condenados a podrirse, banderín de guardia en `finally` equivalente a no tenerlo, tarea larga sin `running`, por lo que la interfaz no muestra progreso,
> campo opcional que impide a `tsc` pescar el identificador no definido, datos de test vacíos que ocultan un defecto fatal, `vitest` que solo transpila y deja que el contrato derive,
> `spawn EPERM` de la sandbox (y por qué `ESBUILD_BINARY_PATH` no sirve), captura por tubería en PowerShell que lleva los errores de `tsc` a cero,
> BOM/caracteres corruptos/desplazamiento de números de línea, y trampas de Git como `git amend -m`, que vacía el cuerpo del commit.

### Añadidos

- **§E Ámbito de almacenamiento `scope` (visibilidad, ortogonal a `family`)**. Antes todos los proyectos compartían una sola base de memoria: los recuerdos de la familia `work` depositados por el proyecto A se recordaban también en las sesiones del proyecto B. Nueva configuración `scope` (`global` por defecto / `workspace`), **ortogonal** al `family` existente (tipo de contenido) — `family` pregunta «qué contenido es», `scope` pregunta «en qué ámbito debe ser visible»; existen los cuatro cuadrantes. «En modo `workspace`, aislar la familia `work` por espacios de trabajo, `chat` global por defecto» es una **decisión de valores por defecto, no una regla derivada** (las memorias personales deben atravesar los proyectos; la superficie de contaminación está justamente entre proyectos).
  - **El cero deriva es constructivo, no contrastado**: mientras `cfg.scope` no sea `workspace`, el `scopeFilterOf` unificado devuelve siempre `undefined` (= sin filtrar); ningún punto de llamada puede hacer pasar por descuido un identificador de espacio de trabajo. Los despliegues existentes (que no definen la clave) se comportan **palabra por palabra** igual que antes del cambio.
  - **El aislamiento se sitúa en el mismo piso que el aislamiento por familia**: no solo a la salida de la búsqueda — **el recuerdo de candidatos de la deduplicación** también filtra. El vaso de candidatos decide las nuevas deducciones; sin filtrado, aquí entrarían registros transversales «invisibles en el proyecto B, pero que ya han decidido la suerte de las memorias del proyecto A» — peor que ningún aislamiento ([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). El camino del grafo filtra en el mismo piso según la pertenencia del **registro de origen**; los caminos de escritura (canalización de extracción / `memory_add` / `memory_import`) comparten el mismo `resolveRecordScope`.
  - **La identidad del espacio de trabajo toma el cwd canónico, no la `WorkspaceId` (uuid) del `dsh-workspace` del host**: el mismo canal de cabeceras que el `parentSession` del §A, disponible en sincronía; declarar un `inject` derribaría el árbol en un host sin ese servicio; el criterio de pertenencia del propio host es «el cwd canónico de la cabecera de sesión == el camino del espacio de trabajo»; el uuid exigiría «un espacio de trabajo registrado», y en directorios no registrados el aislamiento fallaría en silencio. Límite conocida: **los enlaces simbólicos no se resuelven**, la consecuencia es sobre-aislamiento (en el sentido seguro), no fuga ([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **La migración solo etiqueta la pertenencia, sin mudanza ni borrado**: `l1_records` / `l1_fts` reciben cada una las columnas `scope` + `workspace_id`, los datos existentes quedan marcados `global` por el `DEFAULT` del `ALTER` — número de entradas, id, content, created_time palabra por palabra.
  - **En el transcurso se cazaron dos problemas verdaderos**: ① **el relleno de retorno tras la reconstrucción del FTS, sin scope, aplana el aislamiento en silencio** (si los parámetros de `backfillL1Fts` no cuadran con el insert, su propio `catch` línea a línea se lo traga; síntoma: índice vacío con `count=0`); ② **falta de normalización de forma en el lado de la escritura → la memoria entra en base y no vuelve a salir jamás** (la búsqueda pasa la ruta en minúsculas normalizada, la escritura guarda la mayúscula del llamante tal cual — la comprobación de igualdad de cadenas solo puede fracasar). Ambos cazados y reparados por tests extremo a extremo y sondas de mutación.
- **§F Columna vectorial de los nodos del grafo `graph_node_vec` (fundamento de almacenamiento y degradación)**. El grafo tenía solo puntuación léxica ponderada, sin columna vectorial — entidades **semánticamente equivalentes pero por escrito distintas** como «profundidad de la nube» y «DeepRobotics» no podían resolverse la una por la otra. Nueva tabla virtual vec0 **del mismo esquema** que `l1_vec` (la misma codificación, la misma declaración `float[N] distance_metric=cosine`), cuya dimensión **reutiliza** el resultado de detección de capacidades existente — sin una segunda tubería.
  - **La degradación se digiere por dentro**: sin vec0, la creación de la tabla lanza; si la excepción subía hasta el `catch` externo de `GraphStore.init`, el grafo caería de «vía vectorial no disponible» a «**todo el dominio del grafo no disponible**» — búsqueda léxica, proyección, arbitraje, todo se iría con ella. Por eso la columna vectorial lleva su propio `try/catch` estrecho. En los estados apagados la interfaz responde no-op, el llamante no necesita preguntar por el bit de capacidad ([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **Esta ola entrega solo la puerta, sin productor ni consumidor**: la canalización de proyección aún no está cableada para calcular embeddings. Queda registrado honestamente como incompleto — es el comienzo del §F, no su remate.
- **§B Cadena de recibos de las decisiones L1 (infraestructura de trazabilidad)**. Cada registro L1 en `memory.db` es **el resultado de una decisión de deduplicación** (store / update / merge / skip), pero la decisión en sí no dejaba rastro — a posteriori solo se veía «el resultado tiene esta cara», nunca «en qué se fundamentó». Nueva tabla `l1_receipts`: cada decisión de deduplicación deja un recibo (`run_id` / `record_id` / `kind` / **digest sha256 de la secuencia ordenada del vaso de candidatos** `input_digest` / `decided_at`), con la nueva herramienta **`memory_receipts`** y el endpoint RPC **`dsh-memory/receipts`** para la retrotraza en dos dimensiones, por registro o por lote (dados juntos funcionan como Y). El recibo debe existir **antes** del evento — la instantánea de entrada **no se puede reponer a posteriori**, por eso la capacidad se sitúa aguas arriba, sin disparador sintomático ([`ADR-0006`](./docs/adr/0006-l1-decision-receipts.md)).
  - **Tres decisiones de diseño deliberadas para `input_digest`**: **sensible al orden** (el vaso está ordenado; «qué candidatos se veían y en qué orden» es justamente la entrada a reconstruir), **los duplicados no se pliegan** (los duplicados en el vaso son por sí mismos un hecho), **codificación con prefijo de longitud** (si no, `['a|b']` y `['a','b']` colisionarían — si la serialización no es inyectiva, el digest pierde su valor de huella).
  - **Política de retención**: raleo por **número de rondas** (`RECEIPTS_MAX_RUNS = 1000`) — una ventana temporal **no da ningún límite de filas** (el umbral es independiente del ritmo de escritura; un usuario intenso escribiría en 90 días cuantas filas quisiera, el crecimiento ilimitado solo queda **aplazado**); la granularidad del raleo es la ronda, no la fila — ralear por fila cortaría «medios lotes» y respondería a «qué se juzgó en aquella ronda» con una conclusión **aparentemente completa pero en realidad agujereada**, daño **mayor** que «no encontrable».
  - **Línea roja**: el raleo **toca solo `l1_receipts`, jamás `l1_records`** — la primera son datos de observación desechables, la segunda la fuente de verdad del usuario; tocar la propia memoria para ahorrar unos MB es convertir una optimización de capacidad en pérdida de datos.
  - **Aislamiento de fallos**: el recibo es una infraestructura de borde; su fallo de escritura se limita a un `warn` y **nunca interrumpe la destilación L1**.

- **§C Congelación de contradicciones (opcional, apagada por defecto)**. Hasta ahora el **vocabulario de decisión** de la deduplicación constaba solo de `store` / `update` / `merge` / `skip` — el «detector de conflictos» (`CONFLICT_DETECTION_SYSTEM_PROMPT`) detectaba la contradicción y después **el LLM dictaba y escribía directamente** (`update` para sobreescribir o `merge` para fundir), **sin la opción «parar y esperar el veredicto humano»**. Con `conflictFreeze.enabled`, el vocabulario recibe la acción `conflict`: cuando el LLM juzga que «ambas parecen verdaderas y la máquina no puede decidir», la pareja conflictiva se **aparca** en la cola `conflict_pending` — **la memoria nueva entra en base con normalidad, el contenido de ambas partes queda intacto**, y la nueva herramienta **`memory_resolve_conflict`** (RPC: `dsh-memory/conflict-resolve`) entrega el arbitraje a la persona, con las conclusiones `winner` / `loser` / `both`.
  - **La congelación no es «bloquear la escritura», es «no decidir automáticamente»** — implementarla como lo primero haría perder información, peor que el problema que quiere resolver.
  - **Válvula de seguridad**: `maxPending` (límite de cola) / `timeoutDays` (degradación por vencimiento). La semántica es «**no aceptar más**», no «borrar a escondidas los viejos»: las parejas cerradas automáticamente **siguen quedando anotadas en la cola**, con `resolution` anotado `auto` para distinguirlas de las conclusiones humanas. Sin válvula, dos consecuencias ciertas: crecimiento sin límite de la cola; «dos memorias contradictorias recordadas codo con codo» para siempre en base.
  - **Lado grafo**: los nodos del grafo a los que llegan las fuentes de un registro congelado se marcan `disputed` (estado existente, reutilizado; sigue dentro de los candidatos de búsqueda: un estado intermedio «recordado como siempre, pero visible»). Este marcado es **sincronización derivada**, no un sello a sentido único — el arbitraje **levanta** la disputa; un sello a sentido único dejaría nodos ya arbitrados trabados para siempre en `disputed`, y entonces **sería el grafo derivado quien mintiera**.
  - **Cero deriva**: en estado apagado, el prompt de deduplicación es **byte a byte idéntico** al de antes — garantía **constructiva** (el estado apagado hace directamente `return base`), no una comparación a mano ([`ADR-0010`](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### Cambios

- **Nuevas configuraciones** `conflictFreeze.enabled` (apagada por defecto) / `conflictFreeze.maxPending` (100) / `conflictFreeze.timeoutDays` (30, `0` = sin degradación por vencimiento); **nuevos endpoints** `dsh-memory/receipts` y `dsh-memory/conflict-resolve` (cara de endpoints 26 → 28).
- **`L1ReceiptKind` recibe `conflict`**. Al ampliar un vocabulario hay que revisar **todos los lugares que lo consumen** (normalización de recibos, registros de estadística, textos de render, descripciones de esquema) — comprobado en la práctica: una anotación omitida haría que «el modelo **dijo expresamente** que no podía decidir» quedara anotado como `skip_missing` (= «el modelo **no respondió»), mientras toda la auditabilidad del arbitraje del §C descansa en la cadena de recibos — la conclusión del audit sería **exactamente lo contrario del hecho** (peor que faltar un recibo: faltar es «no encontrado», estar mal es «encontrado pero erróneo»).
- **`GraphStore.markSourcesDisputed` (sello a sentido único) → `syncDisputed` (sincronización derivada)**: `active` y fuentes alcanzadas → `disputed`; `disputed` y fuentes que ya no alcanzan → de vuelta a `active`; las lápidas `archived` no se tocan. La canalización transmite **el conjunto de registros de todas las parejas sin arbitrar del momento**, y no solo la pareja nueva del giro.
- **El orden del arbitraje es deliberado**: primero se pone `resolved_at`, después el perdedor sale de escena — al revés, «el registro desapareció pero en la cola sigue figurando sin arbitrar» se nota solo al siguiente clic; la marca va con `WHERE resolved_at = ''`, **un segundo arbitraje no sobreescribe la primera conclusión**.

### Pruebas

- **§B: 5 nuevos archivos de test** (creación de la tabla de recibos y digest, puntos de escritura y aislamiento de fallos, política de retención, consultas a dos dimensiones, retrotraza de extremo a extremo), incluida una **sonda de mutación**: sustituir la tabla de raleo por `l1_records` hace fracasar de verdad el caso de la línea roja.
- **§C: 7 nuevos archivos de test** (vocabulario / creación de tabla / interruptor / semántica de la congelación / válvula / arbitraje / ciclo cerrado), todos por TDD observando primero el RED. Tres criterios **discriminantes** merecen mención: `version===0` (separa la semántica store de la de merge/update), cazar de extremo a extremo el prompt realmente enviado por la canalización (funciones estáticas todas verdes **no prueban** que la canalización pase el interruptor), y la mutación del ramo `both`, que enrojece de verdad el caso.
- Total **34 archivos / 341 casos**; la cadena CI de siete pasos (`typecheck` / `test` / `lint` / `build` / `build:smoke` / `smoke` / `verify-catalog`) toda verde.
- Ciclo cerrado dejado en papel: dos verdaderos `runExtraction` (stub solo en la capa de transporte LLM) → verdadero endpoint de arbitraje, el JSON crudo archivado en `evidence/` del dominio de planificación.

### Corregidos

- **Las acciones no reconocidas quedaban absorbidas en silencio por el ramal de repliegue.** El ciclo de aplicación de `pipeline/l1.ts` ramificaba expresamente solo sobre `store` / `skip`, **todo lo demás caía en el ramo update/merge**. Las decisiones conflict no llevan por diseño ningún `target_ids`, así que `targets=[]` → el registro se anotaba como producto de una fusión «que sustituyó 0 entradas», y `version` calculado como `1`. **Ni error, ni pérdida — la única huella, un número de versión** — es decir, «conflict degradado en silencio a merge/update», justo el comportamiento que el §C pretendía erradicar. **Remedio**: ramo `conflict` expreso; si falla la validación o el interruptor está apagado, **regreso a `store`**, nunca al ramal de repliegue.
- **El portero de endpoints era una copia copiada a mano.** El `ENDPOINTS` de `tests/contract-keys.test.ts` es una **copia manuscrita** del registro verdadero (`MEMORY_ENDPOINTS` de `src/stats.ts`); sus dos aserciones solo concordaban dentro de esa copia (`ENDPOINTS.length === 26`). Cuando el §B, con `dsh-memory/receipts`, subió el registro verdadero a 27, la copia **no lo siguió**, y la aserción de conteo se quedó en 26 — y «la aserción concuerda con la copia, la copia no concuerda con los hechos» pasó **verde de punta a punta**; tras añadir esta vez `conflict-resolve`, **sigue todo verde**. El portero ponía a prueba su propia sombra: con el sistema probado que sea, jamás enrojecería. **Remedio**: nueva aserción `expect([...ENDPOINTS].sort()).toEqual([...MEMORY_ENDPOINTS].sort())` — la lista local debe coincidir **posición por posición** con la única fuente de verdad; la aserción de conteo se queda como señal expresa en los cambios.

- **Carga del árbol de plugins fallida: el esquema de salida de las herramientas usaba la palabra clave `nullable`, no admitida por el DSL** (corrección de una regresión, dejaba a DSH totalmente incapaz de arrancar). Los esquemas de salida de `memory_ruminate` y `memory_ruminate_status` declaraban `nullable: true` sobre `startedAt`/`finishedAt`/`error`, mientras el DSL de value schema de DSH solo admite un conjunto en lista blanca de claves de autor (`description`/`title`/`default`/`examples`/`required`/`enum`/`const` y, por tipos, `type`/`properties`/`additionalProperties`/`items`/`oneOf`). Al compilar el esquema, `defineTool()` lanzaba `JsonSchemaError: schema.properties.startedAt.nullable is not supported by the value schema DSL`, el loader dictó fracasada la carga de la entrada `dsh-memory (dsh-prime-memory)`, la aplicación de todo el árbol se detuvo y el proceso salió con una excepción no capturada.
  **Remedio**: se quitan los 4 `nullable: true`. Semántica sin cambios — en este DSL una propiedad es opcional por defecto; obligatoria solo la hace un `required: true` expreso; y la validación en ejecución salta `undefined`, así que el `startedAt: undefined` devuelto por `execute` sigue siendo legal. Verificación: `tsc` compila + en los artefactos dist ya no está la palabra clave + nuevo caso de regresión de registro de herramientas.
- **Endpoints RPC de rumination todos inalcanzables: al controlador nunca se le inyectaron las deps de endpoint.** `dsh-memory/ruminate-status` respondía siempre `{supported:false,running:false,phase:'idle'}`, `ruminate-start`/`ruminate-cancel` lanzaban siempre «controlador de rumination no inicializado». Causa raíz: `EndpointDeps.ruminate` estaba declarado y las tres implementaciones de endpoint escritas, pero `registerMemoryRpc`, al montar los argumentos de deps, no inyectaba el controlador — `deps.ruminate` quedaba siempre `undefined`, y los endpoints quedaban clavados al ramal de degradación.
  **Efecto visible para el usuario**: el panel de rumination (`RuminatePanel.tsx`) hace un `return null` íntegro cuando `supported === false`, así que se presentaba como «función inexistente» más que como error — por eso el averío pasó tanto tiempo sin ser visto; tras la corrección el panel se dibuja por primera vez.
  **Remedio**: el montaje de deps se extrae a una costura comprobable `buildEndpointDeps()` (único propietario), que escribe expresamente el controlador en el campo `ruminate`; `rebuild`/`embedManager`/`sessionInfo` recorren ahora exactamente el mismo canal de inyección que `ruminate`, sin más parámetros posicionales de repuesto.
  **Verificación**: tras inyectar un stub, `dsh-memory/ruminate-status` responde `supported !== false`.

- **La rumination caía a la primera: `pending.json` se analizaba dos veces sin desempaquetar `buckets`, `TypeError: messages is not iterable`**. El `RuminateController.start()` asignaba directamente como `PendingBuckets` (`{auto,chat,work}`) el `JSON.parse(readFileSync(file))` pasando por su propio `readPendingBuckets()`, pero la forma verdadera en disco es `PendingFile` (`{version,buckets:{auto,chat,work},warmup}`) — **faltaba el desempaquetado de un nivel `buckets`**, así que `buckets[mode]` quedaba siempre `undefined`, y el `for (const m of messages)` de `groupPendingBySession` lanzaba.
  **Efecto visible**: **esta función jamás ha funcionado ni una vez**. El error pasaba por el `catch` (repliegue a cubos vacíos) solo en el caso «el archivo no existe»; pero `persistPending` escribe ese archivo a cada turno, así que en cualquier despliegue real con búfer, pulsar la rumination fallaba con seguridad, el panel mostraba rojo. **Atención, contra la intuición**: el lanzamiento **no tiene nada que ver** con el contenido de los cubos — cubos vacíos lanzaban igual; el viejo juicio «tres cubos vacíos, por eso no se ha visto nunca» era erróneo, la verdadera causa es que la rumination nunca se llegó a disparar (`memory.log` no lleva ningún `反刍开始`).
  **Remedio**: eliminados `readPendingBuckets()` y `readFileSync`, sustituidos por el `loadPending()` de `store/pending.ts` — la **única autoridad** sobre la forma de los cubos, que trae gratis la validación de forma, la comprobación `Array.isArray` por cubos, el recuento de líneas malas `isMessage` descartadas, el agrupamiento del formato viejo `LEGACY_SESSION` y la validación de `warmup`. **Ninguna segunda puerta en `pending.ts`** (esta fue precisamente la causa del defecto: dos caminos de implementación de la misma semántica, uno de los cuales se pudre sin que nadie lo note).
  **Verificación**: nuevo caso a nivel de controlador, primero rojo, después verde (rojo: `TypeError: messages is not iterable` @ `pending.ts:104` ← `ruminate.ts:75` ← `:139`; verde: `total` == número de grupos de sesiones, `mode` deducido de las claves de los cubos); en `dist/pipeline/ruminate.js` ya no está `readPendingBuckets`.
- **Tras un fallo de la rumination, el estado y la interfaz se contradecían.** El camino de fallo nunca escribía `this.status` (el original `:149-155` solo asignaba en el camino de éxito), así que `ruminate-status` seguía respondiendo `phase:'idle'`/`error:null`, y el ramo `failed` de la UI nunca se encendía — el usuario veía el error en rojo, mientras el endpoint de estado aseguraba que todo iba bien. **Remedio**: en el `catch` se escriben `phase:'failed'` y `error`, con `logger.warn` antes de relanzar.
- **Progreso y producción de la rumination siempre a cero, con lo que no se juzgaba el efecto de las correcciones.** `totalL1` solo se declaraba/ponía a cero/se leía, **jamás se acumulaba**; `status.done` no tenía ningún punto de incremento, así que `recordsBuilt` quedaba siempre `0`, y el log de cierre siempre decía `0/N sesiones, producidos 0 registros`. **Remedio**: `PipelineTask` recibe un callback de cierre `onDone` (invocado dentro de `drain`, una excepción del callback no toca la canalización), `enqueue` expone `onTurnDone`, la rumination acumula con él el número real de registros; `doEnqueue` al terminar pone `status.done = index`.
- **Tres puntos de fallo silencioso**: el `catch` de `loadPending` y el `.catch(() => {})` de `doLightRefresh` aplastaban «el archivo no existe (normal)», «ilegible/corrupto (hay que avisar)», «la forma no es la que toca (hay que avisar)» en la misma degradación silenciosa, indistinguible en los log y en el estado del «refresco ligero de un pending vacío legítimo» — el usuario veía `phase:'done'` y lo tomaba por éxito. **Remedio**: `loadPending` distingue `ENOENT` (silencio) del resto (`warn` con la ruta del archivo y la causa), la forma no conforme también `warn`; `doLightRefresh` pasa a `await` y **pone la banderita a cero solo tras el éxito** (antes la ponía a cero también al fallar — se tragaba así la oportunidad de reintentar).
- **Durante el «refresco ligero» de la rumination: mentira de inactividad, ni progreso, ni cancelación** (retorno de campo real). `start()` al no haber rodajas en espera hacía `return await this.doLightRefresh()`, y ese ramo **nunca ponía `running`** — entretanto `ruminate-status` seguía respondiendo `phase:'idle'`/`running:false`. Y es que el L2/L3 aquí es una **llamada LLM real** (medida por encima de los 70 segundos por llamada); `start()` quedaba colgado del await, ocupando la guardia.
  **Efecto visible**: tras el clic, en la interfaz solo una frase estática, **sin barra de progreso, sin botón de cancelar, sin fase, sin duración**; un segundo clic daba «la rumination ya está en marcha» — cierto, pero sin información alguna, imposible decir si corre o si está congelado.
  **Remedio**: el refresco ligero **reporta con honestidad** — registra `total` según el número de familias a la espera L2/L3, incrementa `done` paso a paso, y recibe `RuminatePhase='refreshing'` con un `detail` que describe la acción en curso (por ejemplo «consolidación de escena L2 (chat)»); el log de cierre pasa del silencio a `refresco ligero de rumination terminado: 2/3 pasos, 84 s`. El panel muestra el nombre de la fase, `completados/total de pasos (porcentaje)`, el **tiempo realmente transcurrido** y la acción actual, y trata `refreshing` como estado en marcha.
- **No se muestra el tiempo empleado durante la rumination**: una llamada L2/L3 puede tirar minutos; mostrar solo «en marcha» no distingue «corre» de «está congelado». **Remedio**: mientras corre, se recalcula y se muestra cada segundo `transcurrido X min Y s`.

### Cambios

- **`RuminateStatus` recibe `detail`; `RuminatePhase` recibe `refreshing`**: observabilidad para pasos a escala de minuto (retrocompatible: campo opcional añadido + nuevo miembro del tipo unión). `detail` da «sesión <id> (i/N)» en fase de destilación, y la acción L2/L3 actual en fase de cierre/refresco.
- **`DshMemoryRequestMap` completa las tres claves de rumination** (corrección de contrato, devuelve al servicio la barrera de tipos de CI): la tabla de respuestas llevaba tiempo declarando `dsh-memory/ruminate-status|start|cancel`, y `DshMemoryEndpoint = keyof DshMemoryResponseMap` por eso los incluía en la unión de endpoints; pero en la **tabla de peticiones faltaban las tres claves correspondientes** — el `DshMemoryRequestMap[K]` de `client/src/rpc.ts` daba `TS2536`, `tsc -p tsconfig.client.json` fallaba sin parar y **el `npm run typecheck` de CI enrojecía con seguridad**. Corregido con tres líneas `Record<string, never>` de la misma forma que `rebuild-*` (los tres endpoints sin parámetros de entrada). Verificación: los tres tsconfig salen con 0, la cadena completa de `npm run typecheck` sale con 0.
- **El montaje de deps de `registerMemoryRpc` extraído a `buildEndpointDeps()`**: costura comprobable para «qué controlador cae en qué campo», con el tipo `EndpointDepsInput` delimitando la cara de inyección, de modo que las inyecciones faltantes afloran ya en la compilación (este defecto hasta ahora era una degradación silenciosa en ejecución). `handleEndpoint` y `EndpointDeps` también se exportan para llamada directa en los tests.
- **Cerrojo de arranque `starting` para la rumination**: `loadPending` introduce un punto de cesión de la event loop entre la guardia y la puesta de `status.running`; un doble clic / ronda de RPC puede atravesar la guardia por ambos lados, y los dos `sessions` se sobreescribirían. Una nueva banderita cierra esa ventana. **Atención**: la banderita se rearma expresamente al final del ramo distilling, no en un `finally` — porque `doEnqueue` encola de forma asíncrona, y un `finally` alzaría la banderita al momento, desactivando la guardia; la guardia que atraviesa los `await` es `status.running`.

### Pruebas

- Nuevas «guardias de inyección de controladores en endpoints» de la capa RPC, 5 casos: para ambas familias `rebuild` y `ruminate`, «montado → status/start/cancel alcanzables» y «sin montar → status degrada, start/cancel reportan no inicializado», más el ramo de la guardia de degradación de almacén de `rebuild-start`. Las dos familias comparten el mismo patrón (controlador opcional + respuesta de degradación + inyección de deps); `rebuild`, cuya inyección ya era correcta, hace de grupo de control para clavar la forma del patrón. Casos de test 194 → 199.
- Nuevo `tests/ruminate.test.ts`, 5 casos, que clava **el verdadero camino de lectura del controlador**, un contrato con cobertura cero hasta ahora: tres cubos con mensajes verdaderos → sin lanzamientos, `total`/`mode` correctos; JSON escrito a mano en forma de disco (**sin ir y volver por `savePending`**, para que ambos lados no puedan equivocarse a la vez y aun así pasar); tres cubos vacíos → refresco ligero; archivo ausente → refresco ligero (ENOENT, camino normal); `start()` paralelos, solo uno pasa. Casos de test 199 → 204.
- **De paso, limpieza de los 10 errores de lint preexistentes en `tests/`** (importaciones/variables sin usar, `require()` convertidos a importaciones ESM de cabeza, condiciones siempre verdaderas), para que `lint` pueda abarcar `tests`. **Hasta ahora el directorio de tests vivía entero fuera del lint.**
- **`npm test` y `npm run lint` conectados por primera vez a CI**: `.github/workflows/ci.yml` solo corría `typecheck → build → build:smoke → smoke → verify-catalog` y **nunca lanzaba los tests** — escribir tests sin CI vale lo mismo que no escribirlos. La barrera está ya de servicio.

### Limitaciones conocidas

- **La barrera de tipos de `tests/` está abierta solo en parte (trinquete)**: nuevo `tsconfig.test.json` incluido en `npm run typecheck`, pero como 8 archivos de test existentes llevan unos 60 errores de tipos (módulo `MemoryConfig` desplazado, `DistillBudgets` sin `graph`, `UserMessage.turn`, asignación de arrays de solo lectura, montones de `as` desnudos en `rpc.test.ts` etc.), por ahora solo están incluidos `tests/ruminate.test.ts` y `tests/stores.test.ts`. Ver `pending-issues.md` P8 — **constata que los tests han derivado de los contratos de tipos y que vitest solo transpila sin comprobar; por eso todo estaba verde sin que nadie se diera cuenta**.
- **La rumination padece una doble fuente de verdad disco/memoria**: la lista de sesiones viene del `pending.json` en disco, pero la extracción verdadera, en `runner.ts:667`, toma los mensajes de los **cubos en memoria** por `sessionId` — así que el `session.messages` pasado no influye en el resultado. En el margen de la ventana son posibles destilaciones perdidas o vueltas en vacío (`total` inflado). Recomendación: que el runner exponga una vista de memoria de solo lectura, ver `pending-issues.md` P9.
- **Carrera al cierre de la rumination**: la cadena de `setImmediate` no espera a que la cola se vacíe, incluso una sola sesión dispara enseguida `finalize`, y el L2/L3 corre en balde contra L1 rancio (los registros se consolidan después en `l1.ts:264`, **no se pierden**). Ver `pending-issues.md` P10.
- **Una llamada LLM en curso durante la rumination no es interrumpible**: «cancelar el orden» se detiene solo **tras completarse el paso en curso**. Un L2/L3 puede tirar minutos — de ahí el retraso de la cancelación.

## [0.10.0] — 2026-09-06

### Añadidos

- **Proyección a grafo de conocimiento** (proyección reconstruible de L1; responde a «en qué estado están ahora personas/proyectos/organizaciones/herramientas/lugares»): los registros nacidos de la destilación L1 se dan por lotes al modelo, que propone entidades y relaciones orientadas; `applyGraphProjection` valida con dureza antes de escribir — **cero hechos sin procedencia**: los `sourceRecordIds` de cada nodo/hecho/arista deben pertenecer todos a los registros reclamados por ese lote, las propuestas de fuera del lote se descartan enteras en silencio, y toda conclusión del grafo se retrotraza por `nodo → sourceRecordIds → registros L1 → fuente de verdad JSONL`. Desambiguación de entidades (normalización NFKC + fusión por coherencia de tipo, acumulación de alias), historia de estados (supersede + cierre por validTo, `currentState` reconstruido solo de los hechos activos), cadena de anclaje temporal de cuatro peldaños (`activity_start_time → activity_end_time → timestamps → createdAt`, sin prueba no se adivina ninguna fecha). La familia de tablas del grafo puede dropearse y rehacerse en cualquier momento, no sirve como fuente de verdad.
- **Cola de tareas de proyección** (GraphStore, degradación independiente: si la inicialización falla, solo el grafo pasa a no-op, sin infectar el almacén principal): estado de job persistido como máquina de estados pending → running → completed/dead, deduplicación empujada al SQL (mapping en vuelo + registro de proyección, dos tablas de índice, sin barrido integral de los jobs); sin inversión de prioridades (destilación nueva 10000 > re-proyección del caudal existente 100); attempts con tope pasan a dead, `nextAttemptAt` con retroceso exponencial, recuperación al arranque running→pending; tras `deleteL1Batch` propagación del borrado (nodos/aristas con todas las fuentes invalidadas se marcan perezosamente archived). Las llamadas LLM nunca entran en una transacción (claim y complete son dos costuras de transacción; complete comete atómicamente en una sola).
- **Búsqueda en el grafo y herramientas**: búsqueda ponderada por campos (name×6/aliases×5/tags×5/currentState×4/facts×4/relations×3/type×2), filtro del ruido de adyacencia cuando solo aciertan las palabras de las relaciones, salida explicable con `matchedFields` + `matchReason` en chino; nuevas herramientas `memory_search_graph` (cartas compactas de nodos) y `memory_expand_graph_node` (hechos al completo con historia + aristas de relación), sometidas a la misma negación de lectura por modalidad/inyección que `memory_search`, y filtradas por familia de sesión (la modalidad pura solo ve los nodos derivados de su familia).
- **Endpoints RPC 24 → 26**: `dsh-memory/graph-search` (búsqueda) y `dsh-memory/graph-node-get` (despliegue del detalle; un id colgado devuelve `node=null` sin lanzar); contrato con única fuente de verdad sincronizado, la cara de llamadas genéricas del cliente recibe los tipos de los nuevos endpoints sin cambio alguno.
- **Ensanche de las claves de presupuesto**: `DistillBudgets` recibe la clave `graph` (por defecto 8000, fila grafo de la página de ajustes editable); `layerKeyFor('graph')` vuelve expresamente a la resolución global, no cae nunca en la cadena de capa l1; el coste de la proyección del grafo entra en el total y en el agrupamiento por modelos, pero no en la tabla estratificada l1→l2→l3 ni en las tendencias (exención de vía de borde).

### Cambios

- **Nueva configuración**: `config.graph.enabled` (nivel de despliegue, **false** por defecto — aun activada, el interruptor de ejecución de la destilación debe ser también verdadero; barandilla de la bomba: como mucho una tarea de grafo por drain, siempre cediendo el paso a los turnos de destilación en tiempo real).
- Versión del plugin 0.9.0 → 0.10.0 (cambio de la cara de endpoints).

## [0.9.0] — 2026-09-01

### Añadidos

- **Canal de clasificación tosca Hall**: cara de atributos toscos ortogonal a `family`/`type`. `types.ts` define `HALL_CATALOG` (única fuente de verdad: los principales `work`/`relationships`/`general` activados por defecto, los experimentales `finance`/`journey` con marca `experimental`); `config.hall.enabled` decide qué Hall participan en el marcado. En la fase de extracción L1, `metadata.hall` se etiqueta automáticamente según la lista activada (si clasificar con certeza no es posible, el campo se omite, sin forzar General); el contrato `ListRecordsRequest.hall` y `UiRecord.hall` se ensancha, el navegador de memorias recibe un desplegable de filtro por Hall y las cartas una insignia Hall.
- **Sobreescritura en ejecución del embedding remoto**: `baseUrl`/`apiKey`/`model`/`dimensions` del embedding pasan a ser **editables en la página de ajustes**, sobreponiéndose en ejecución al YAML de despliegue (`effectiveCfg` inyecta el subárbol `cfg.embedding`, independiente del canal llm); `EmbeddingManager` recibe `getEff()`, que lee la configuración eficaz tras la sobreescritura, para que la edición desde la página surta efecto al momento.
- **Herramientas de escritura-borrado de altos privilegios**: se registran `memory_add` («recuerda X» explícito → escribe una entrada L1 directamente en base, `hall` opcional) y `memory_delete` (borrado tras acierto de la búsqueda semántica, como mucho 10 entradas), ambos bajo la barrera `live.memoryMutate` (modo de altos privilegios de la página de ajustes); el navegador de memorias recibe un interruptor de altos privilegios (con doble confirmación) y un botón de borrado unitario.
- **Documentación multilingüe** (a la par de `multilingual-docs-skill`): `README`/`INSTALL`/`CHANGELOG` cubiertos en `zh`/`en`/`ja`/`ko`, con enlaces cruzados de conmutación de idioma en la cabecera de cada página (escritos en lengua materna), páginas `ja`/`ko` con nota de compatibilidad con DSH.
- **Cadena de herramientas**: enganche de ESLint 9 en configuración plana y de Vitest, nuevos `npm run lint`/`npm run test`, más la primera remesa de unit tests para `HALL_CATALOG` y el prompt de extracción Hall.

### Cambios

- **`apiKey` del embedding remoto pasa a ser opcional**: se aceptan servicios `/embeddings` autoalojados sin clave (`remoteCeiling` ya no impone `apiKey`); sin clave no se inyecta la cabecera `authorization`, para que un `Bearer` vacío no sea rechazado.

### Corregidos

- El embedding remoto ya no envía una cabecera `Bearer` vacía cuando `apiKey` está vacía.

### Limitaciones conocidas

- El punto de construcción de `EmbeddingManager` (`src/index.ts`) aún no recibe `getEff`; la sobreescritura de ejecución aún no afluye al servicio de embeddings interno del gestor, el enganche queda para más adelante.

## [0.8.11] — 2026-08-29

### Corregidos

- **Adaptación móvil del control de modalidad de sesión**: la píldora y el selector deslizante hasta ahora solo estaban pensados para el dispuesto web de escritorio — la capa flotante subía con el eje en el centro de la píldora, pero la píldora está a la izquierda de la barra de entrada: en viewports estrechos de teléfono, la mitad izquierda de la capa quedaba cortada por la pantalla. La capa hace ahora un asido horizontal del viewport: se mide una vez al abrir, si está cortada (incluidos los desplazamientos de disposición como la apertura de la barra lateral, que empuja la zona de entrada hacia el borde), se adosa al borde automáticamente; en escritorio naturalmente está dentro de la pantalla, cero cambio de comportamiento;
  el cierre por clic fuera pasa de `mousedown` a `pointerdown` (en iOS la zona de solo texto no sintetiza eventos mouse, la vieja implementación dejaba la capa abierta en el teléfono); las zonas de pulsación de la píldora y del raíl se ensanchan arriba y abajo con una zona caliente invisible conforme al estándar táctil de 44px (visualmente ni un píxel, la geometría de la capa sin cambios, uniforme en todos los terminales — en escritorio la zona de diana pulsable también crece). La lógica de interacción del selector deslizante (fijar la modalidad al pulsar, proyección de la inercia al soltar con imán) queda sin cambios.

## [0.8.10] — 2026-08-28

### Añadidos

- **«Solo escritura» a nivel de sesión (Issue #38)**: ciertas sesiones quieren del sistema de memoria «dejar entrar, no dejar salir» — seguir capturando la conversación y participando en la destilación, pero no inyectar en la sesión actual ninguna memoria. Antes la modalidad apagada era la invisibilidad total (apagada incluso la captura, rodajas en espera suspendidas), y el interruptor de recuerdo tenía solo la granularidad global — esa combinación era inexpresable. El panel flotante recibe ahora un **interruptor «Inyección» de tres estados (sigue al global / encendido / apagado)**: en «apagado» la sesión pasa a solo-escritura — la captura L0 y la destilación L1→L2→L3 siguen como siempre, mientras la inyección del recuerdo, las zonas estables de perfil/navegación y la guía de herramientas se paran juntas;
  las herramientas de lectura como `memory_search` responden con el aviso de solo escritura (la escritura va por el gancho de captura, no por las herramientas: ninguna brecha semántica).
  La cara de la píldora cambia con el estado a `记忆·只写` (el estado de inyección tiene prioridad en la cara, el nombre de familia se retira al raíl); la sobreescritura se persiste por sesión
  y es ortogonal a la modalidad (cambiar de modalidad no la pierde); «sigue al global» la borra; la combinación inversa
  «global apagado + sesión particular encendida» también vale. Cadena de prioridades: techo de despliegue > interruptor global > sobreescritura de sesión > modalidad apagada (la semántica de la invisibilidad total
  sin cambios). Las causas de desactivación de «aciertos del recuerdo» en la carta flotante se afilan al mismo tiempo (nueva causa «sesión solo-escritura»).
  Adecuado para sesiones de depuración/evaluación, sensibles/de un solo uso, de larga vida en segundo plano — todo lo que quiera «absorber sin molestar».

  ![Sesión solo-escritura: rótulo de la píldora cambiado e interruptor de inyección de tres estados](assets/changelog/0.8.10/01-write-only-pill.png)

## [0.8.9] — 2026-08-27

### Añadidos

- **Enrutamiento independiente de la destilación por capas (Issue #34 / ADR-0005)**: las capas de destilación piden al modelo cosas distintas (L1,
  muy frecuente, quiere ser barata, rápida y estable; L3, rara y con entradas grandes, quiere capacidades fuertes); ahora **cada capa puede recibir su propia cadena de reserva completa**.
  Doble entrada: el YAML de despliegue `llm.layerRoutes` (claves de capa l1/l2/l3, la línea de cabeza debe nombrar expresamente proveedor+modelo)
  y `distillLayerChains` en ejecución desde la página de ajustes; prioridad dentro de la capa **cadena de capa en ejecución > cadena de capa estática > cadena
  global por defecto**, a peldaños como respaldo; no vacía = sustitución íntegra de esa capa (la degradación de una capa tapada nunca recae en la cadena global), las capas no configuradas no cambian ni un bit; el fijado del despliegue solo cierra el lado de ejecución (las cadenas de capa estáticas valen como siempre). La sección «Parámetros de destilación» de la página de ajustes se rearma en **panel por segmentos** (global / L1 / L2 / L3): puntos de estado de los segmentos en vista general (azul lleno = personalizado en ejecución / hueco = YAML estático / gris = sigue al global)
  + una línea de leyenda (la relación de prioridad cuelga del tooltip)
  + nota «en uso: qué capas» en el panel global + presupuestos por capa agrupados por capa (semántica sin cambios). El engordamiento ×4 de los presupuestos de salida por capa en high/xhigh/max
  sigue el nivel de la capa (candidato de cabeza de la cadena de capa > candidato global); la contabilidad no cambia (las filas token_cost
  ya se atribuyen por capa + ruta realmente servida).

  ![Panel por segmentos de los parámetros de destilación · global](assets/changelog/0.8.9/03-layer-segmented-panel.png)
  ![Panel de la capa L1 · vista en solo lectura del seguir al global y presupuestos por capa](assets/changelog/0.8.9/04-layer-l1-panel.png)

- **Indicador de ocupación del contexto (arco luminoso de memoria en torno al anillo oficial + desglose en el panel de detalle)**: el contenido de memoria inyectado por el plugin antes se hundía en las grandes categorías del anillo oficial de contexto; ahora — por fuera del anillo oficial de la barra de entrada, un **delgado arco luminoso** azul de marca
  (longitud = cuota de la memoria en la ventana, en la misma imagen que el anillo oficial); al abrir el panel oficial, abajo aparece una sección «ocupación de memoria» con dos líneas, **fragmentos de recuerdo / zona estable de memoria** (en el formato oficial `~5.5K` y valores en colores vivos). Los números van por la misma heurística de densidad fija que el contador oficial de tokens (`ceil(chars/4)+cargos`,
  régimen UTF-16), el denominador es la ventana declarada oficialmente del modelo principal de conversación; las sesiones viejas siguen atendidas (barrido de la
  surface de la sesión live + relleno leyendo los prefijos guardados del servicio de persistencia), al reiniciar no se pierde nada (escritura atravesante de occupancy.json);
  tras OFF lo adquirido sigue visible y se desvanece naturalmente con la compresión. Implementación puramente aditiva: quita todos los nodos añadidos y la interfaz vuelve bit a bit a la forma nativa.

  ![Desglose de la ocupación de memoria en el panel de detalle](assets/changelog/0.8.9/01-panel.png)
  ![Arco luminoso de memoria en torno al anillo oficial](assets/changelog/0.8.9/02-halo.png)

## [0.8.8] — 2026-08-26

### Añadidos

- **Única fuente de verdad del contrato RPC `src/contract.ts`**: los tipos de petición/respuesta de los 23 endpoints `dsh-memory/*` se concentran en un módulo types-only (cero código de ejecución), compartido entre el lado host (tabla de case en stats.ts) y el lado cliente — la deriva del contrato se ve en la compilación, en vez de esperar a que la UI dibuje undefined. Los tipos de datos puros de los módulos host (MemoryStats / RebuildStatus / familia CostSnapshot /
  EmbeddingStateView / MemoryLiveSettings / RecallSessionStats etc.) migran al contrato y conservan en el sitio su re-export; `EFFORT_CHOICES` vuelve a clavar con `satisfies` la deriva del vocabulario.
- **Migración de la mitad cliente a TS/TSX + paquete esbuild**: `client/client.js` (3433 líneas de ES5 monofichero escrito a mano) se reescribe como TSX multifichero en `client/src/` (estratificado en base/controles/pill/tabs),
  empaquetado vía `scripts/build-client.mjs` (esbuild, cuerpo cjs envuelto en un factory wrapper, isomorfo a los paquetes oficiales dsh-client-ui-*) que produce un `dist/client.js` monofichero. react / react/jsx-runtime /
  @deepseek-ai/* todos external (inyectados por require del host, contra el doble react); **cero cambio de comportamiento** (UI equivalente al píxel, endpoints RPC y cargas sin cambios, protocolo de handoff sin cambios). Nuevo
  `npm run typecheck` (doble comprobación tsconfig + tsconfig.client.json); la sección 21 del smoke pasa a aserciones sobre el **artefacto** dist/client.js (forma del protocolo + cableado de externals + migración equivalente de las aserciones existentes sobre tokens/
  redondeos/campo de partículas).
- **Editor de la cadena de enrutamiento de destilación (UI de la página de ajustes, lista unificada)**: una lista ordenada sustituye al viejo conmutador global de «reflexión de la destilación» y al selector monorruta de «modelo de destilación» — la 1ª línea es la ruta principal (distintivo «principal», puede quedar vacía y seguir el modelo por defecto), las líneas siguientes degradan en orden; **el nivel se fija ruta por ruta** (por defecto «sigue la configuración del despliegue»,
  siempre pasada por el morseteo de capacidades). Nueva clave de ejecución `distillChain` (≤ 8 entradas; la línea de la ruta principal vacía en dos o llena en dos, las líneas de reserva obligatoriamente explícitas, duplicados rechazados; array vacío = seguir la configuración del despliegue). RPC: llm-providers recibe un bloque `chain`
  (current con proyección de las claves viejas / static / effectiveChain / source), llm-models adjunta a cada modelo una tabla `efforts`. La posición es la prioridad: la 2ª línea puede trocarse con la principal / sustituirla (una principal vacía sustituida no se conserva); pinned solo lectura; en modo «sigue», un botón «edita como cadena de ejecución» copia la cadena estática de un clic. Especificación de diseño en `design/settings-spec.md` (sección RouteChainEditor).
- **Cadena de reserva de la destilación (variante 1 del #31)**: `llm.fallbacks` como lista de objetos (entrada = provider + model +
  `reasoningEffort` opcional) — al fracaso de la ruta principal (error/corte/error de red/salida vacía), degradación automática en el orden de las entradas, retorno en cuanto una ruta tiene éxito; las entradas idénticas a la principal se saltan; cada ruta goza del íntegro `llm.timeoutMs`; el nivel de una entrada no vacía pisa el nivel global (la toma de control íntegra de la vieja clave de ejecución
  `reasoningEffort` — sello de las entradas incluido — sigue actuando sobre los valores existentes cuando `distillChain` no está configurada); la cancelación voluntaria del llamante no degrada y sube tal cual; al fracaso total el último error se entrega al retroceso exponencial
  por sesión ya existente. El coste en tokens y el uso de destilación se contabilizan en cada intento, el éxito anota la ruta que lo sirvió realmente; el cambio de degradación va al log info + un solo aviso si una ruta única falla sin fin. Por defecto array vacío = comportamiento de ruta única sin cambios. Los README en chino e inglés reciben la sección «cadena de reserva de la destilación y modelos lentos al TTFT» (con ejemplo de configuración y tres niveles de atenuación).

### Cambios

- **La página de ajustes quita el conmutador global de «reflexión de la destilación» y el selector monorruta de «modelo de destilación»**: fundidos en el editor unificado de la cadena de enrutamiento (niveles por ruta). Las viejas claves de ejecución `reasoningEffort`/`distillProvider`/
  `distillModel` conservan su semántica bit a bit (effectiveCfg solo reconoce un `distillChain` expreso, los valores existentes se leen por compatibilidad), la UI ya no escribe en ellos.
- **La salida vacía se reclasifica como fracaso de la llamada**: `callLLM` ante «el stream termina con normalidad pero con 0 caracteres de salida» pasa de devolver una cadena vacía (log warn) a lanzar (el diagnóstico completo en log se conserva) — el viejo comportamiento solo aplazaba el fracaso al parser JSON/Markdown de aguas abajo, con diagnóstico más pobre; toca también a los despliegues sin cadena de reserva, el camino de acogida de fallos de las capas de destilación existente (solo log, jamás bloquea la canalización) queda naturalmente compatible.

## [0.8.7] — 2026-08-25

### Añadidos

- **Panel de costes en tokens (#30, contribuidor @Irvington258)**: el coste en tokens de cada llamada LLM de destilación
  (l1-extract / l1-dedup / l2 / l3) se escribe por clave compuesta `provider/model` en la tabla de detalle SQLite `token_cost` (con migración de la columna provider de la vieja tabla), la página de ajustes recibe la pestaña «Costes»:
  líneas de tendencia coloreadas por modelo (fichas de las series de gráficos `--dsh-mem-chart-1..8`, granularidad día/semana/mes +
  ventana de los últimos N días forzada a granularidad diaria + filtro por niveles L1/L2/L3), tabla capas × ventanas temporales (número de llamadas /
  tokens de salida y de razonamiento / media / mediana, la mediana calculada en el lado JS), lista acumulada por modelo,
  recogida por el RPC de solo lectura `dsh-memory/token-cost`, sondeada cada 5 s. Criterios de los datos: entradas contadas en caracteres
  (el usage en streaming de dsh no incluye los tokens de entrada, la misma contabilidad que llm-usage), salida/razonamiento en tokens;
  la contabilidad cuelga de la salida de callLLM y se anota en ambos caminos éxito/fracaso; el fracaso de la contabilidad solo warn y jamás bloquea la destilación;
  cachés de prepare al construir las instrucciones; los referencias de módulo se liberan al desinstalar el plugin.
- Clave de configuración `tokenCost.retentionDays` (por defecto `365`, `0` = conservación indefinida): días de retención del detalle de costes,
  con limpieza rodante al escribir; el techo de la ventana «últimos N días» del panel de costes coincide con este valor (tras liberarse la retención, el
  límite de entrada del cliente se ensancha a 3650, el techo verdadero lo verifica el backend según la configuración).

### Cambios

- Devolución a la especificación de diseño: `global-spec.md` recibe una sección «colores de las series de gráficos» (categorías de la codificación cromática para visualización de datos —
  exención funcional del cerrojo de acento único, precedente: los colores de las modalidades; 8 grados de fichas para ambos temas + valores de contraste AA recalculados,
  claro todo ≥ 3:1 / oscuro todo ≥ 4.29, el grado 1 anclado al azul de marca, el grado 8 en gris neutro para «otro»);
  `settings-spec.md` recibe la sección «pestaña de costes (CostTab)»; README en chino e inglés sincronizados en explicación de función y
  filas de la tabla de configuración; el smoke recibe aserciones sobre el valor/límites de retentionDays y el cableado de las fichas de gráficos.

## [0.8.6] — 2026-08-24

### Añadidos

- **Ponderación de frescura del recuerdo (#29 variante B)**: el orden del recuerdo pondera suave con `relevancia × max(0.5, 0.5^(Δdías/vida media))`
  (Δ sobre el updated_at de la memoria) — entre candidatos de relevancia parecida pasan primero las memorias frescas; en las sesiones largas los puestos del recuerdo
  rotan naturalmente con el uso, las entradas de antigüedad ya no monopolizan el top-N. Decisiones de diseño (a frente de los arbitrajes de Generative Agents y de la
  práctica RAG de producción): **multiplicativo y no aditivo** — la frescura solo reajusta puestos entre candidatos de relevancia vecina, jamás se impone a la
  relevancia (lo aditivo dejaría subir por novedad memorias nuevas pero fuera de tema); **suelo de decaimiento en 0.5** — una memoria vieja pierde como mucho la mitad
  del puntaje de ordenación, los hechos de largo plazo («la preferencia de café escrita hace tres años») nunca se hunden, con lo que la vida media es un regulador poco sensible;
  las entradas sin updated_at cuentan como las más viejas (el suelo toma el timón, cero casos especiales). Colgada en la única costura de la búsqueda
  (tras los umbrales de las tres vías de `L1Store.search()`, antes del corte), de modo que la inyección del recuerdo y la herramienta memory_search quedan automáticamente coherentes;
  **el recuerdo de candidatos de la deduplicación (searchCandidates) expresamente no lo aplica** — el camino de escritura que busca las viejas entradas de igual
  semántica debe equiparar lo nuevo y lo viejo; el decaimiento haría perder a la deduplicación hallazgos. `recall.decayHalfLifeDays` por defecto 30 días, 0 = desactivado
  (clavable a 0 para la comparabilidad de las bases del bench); el campo score de los aciertos no se reescribe (el orden usa el puntaje ponderado, la presentación sigue reflejando la relevancia de búsqueda);
  el idf no se lleva aparte (integrado en la vía BM25, sin equivalente en la vía vectorial); la importance (priority) por ahora no se activa (la salida actual
  de la extracción es casi constante, su ganancia al orden tendería a cero; la fórmula le reserva un puesto).
- **Deduplicación del recuerdo (ahorro de tokens)**: dentro de la misma sesión, las memorias ya inyectadas no se inyectan otra vez — cuando el usuario remacha
  sobre una pregunta afín/semejante, la búsqueda reencuentra las mismas entradas, pero el contexto del modelo ya las contiene; volver a inyectar es puro derroche
  (~2000 caracteres ≈ 1000 tokens por turno como mucho). Semántica de puro filtrado: quedan tantas ocasiones frescas como se inyectan, la supresión íntegra (0 entradas)
  es un estado correcto, no un fallo. Granularidad = id de la entrada L1: la fusión/actualización de la deduplicación cambia el id, las memorias con el contenido cambiado se
  liberan naturalmente del bloqueo y se vuelven a inyectar. Cuando el contexto se comprime con `/compact` o se vacía con `/clear`
  (evento `agent/session-start`), el registro se reinicia — el contenido inyectado ya salió del contexto del modelo, la memoria puede volver a inyectarse;
  `resume` no reinicia (la historia sigue aquí). El registro se persiste en `recall-dedupe.json` del directorio de datos
  (escritura atravesante serializada y atómica, la misma receta que session-modes; LRU de 200 sesiones / tope de 512 ids por sesión /
  caducidad a los 90 días; cualquier fallo de I/O degrada a memoria y nunca bloquea el camino del recuerdo — el sobrecoste del camino caliente queda reducido a una consulta de Set en memoria en O(hits)). Las estadísticas reciben el contador acumulado `suppressedRecalls` (consultable vía RPC session-stats),
  log de debug en cada supresión; el criterio de la carta flotante sigue siendo continuo (los turnos de supresión íntegra cuentan en hitTurns — la memoria
  relevante ya está en el contexto, en esencia es un acierto).

### Corregidos

- **El import de records.jsonl de la vieja versión atascado para siempre (#28)**: si en los registros del viejo escriba faltaba cualquiera de los campos `type`/`priority`/
  `scene_name`, el `undefined` era rechazado por la capa de binding de node:sqlite — y el repliegue unitario fracasaba sistemáticamente en bloque (los campos faltantes de la misma
  remesa de escriba llegan juntos), el archivo se quedaba en el sitio, cada arranque reintentaba y los datos nunca entraban en base. Arreglo:
  **red de seguridad de campos en la capa de binding** (`upsertL1InTx`/`upsertL0Batch` normalizan las variables locales, tabla principal/vector/FTS comparten
  los mismos valores de origen; valores por defecto tomados de las columnas del esquema: `type='' / priority=50 / scene_name=''`, el lado L0 `sessionId='default' / role='' / recordedAt='' / timestamp=0`) —
  un solo arreglo cubre los imports de versiones viejas, reindex, backfill y todas las escrituras ordinarias; al paso desaparece el riesgo de TypeError de `familyForType(undefined)`
  (tras la normalización, repliegue a la familia chat). El import L0 de versiones viejas recibe al mismo tiempo un umbral mínimo de validez (recuento de las líneas malas
  sin id/content descartadas, hasta ahora cero filtrado). Nota: la «ausencia de aislamiento línea a línea» del informe no se sostiene — el repliegue unitario ya existía
  (el log del informe da fe de ello), lo que faltaba era la red de campos; el fusible `.failed` se salta por consenso (la causa conocida del ciclo
  está curada; las formas desconocidas esperarán a aparecer de verdad).
- **El embedding local congelaba la página entera (incidente de nivel prestacional)**: la carga del modelo de transformers.js y la inferencia ONNX giraban en origen de forma sincrónica en el hilo principal del host — el `run`/`loadModel` de onnxruntime-node (v1.24.3) son llamadas sincrónicas en un callback de setImmediate (la envoltura Promise no descarga el cómputo); con el embedding local activo (embeddinggemma-300m, medido ~0,3–1,3 s de inferencia por entrada), cada turno de conversación — escritura L0, query de recuerdo, escritura de destilación, lotes de reindex — congelaba la event loop segundos enteros: ninguna interacción en las páginas dsh respondía. Arreglo:
  la inferencia se muda en bloque a un hilo worker (`resources/embedding-worker.cjs`, el hilo principal conserva solo el proxy de protocolo
  `LocalEmbeddingService`): inferencia entrada por entrada + cesión entre entradas, una petición unitaria (query de recuerdo) se cuela adelante y no espera en la cola
  del lote de reindex; medido: durante un lote de 8 embeddings (el viejo camino congelaba ~10 s seguidos), el muestreo del hilo principal cuenta 0,0 ms de exceso. Al paso, refuerzo semántico: el morseteo interno `embeddingTimeoutMs` del camino del recuerdo pasa para el embedding local de «ignorado» a realmente eficaz (abandono por carrera, respuestas tardías descartadas). El crachá del worker no se autorepara (estado failed con bajada de la cadena FTS; cambio de fuente/reinicio para recuperarse);
  `close()` = terminate, la semántica «terminated no resucita» se conserva.
- **Tormenta de reintentos de la destilación (quemado encadenado de llamadas durante los fallos del LLM)**: tras un fracaso de extracción L1 (p. ej. timeout de pasarela de 120 s), la red
  de inactividad seguía apilando cada 30 s tareas de destilación force, que durante la espera del LLM se hinchaban en cadenas de llamadas sin fin
  (prueba en memory.log del 2026-08-24: cada 2 minutos una ronda de llamadas de 120 s, sin convergencia). Arreglo: retroceso exponencial por sesión
  (arranque a 60 s, duplicación, tope 30 minutos, puesta a cero al consumo con éxito; las rondas de reconstrucción exentas — la acción expresa del usuario
  tiene su propia UI de fallo/cancelación), durante el retroceso tanto la red de inactividad como el disparador de umbral se saltan esa sesión.
- **Endurecimiento de seguridad de paso (semántica sin cambios)**: todas las fronteras de lectura/escritura de archivos de las herramientas bench y del smoke-test pasan a escritura
  de contención en línea (verificación startsWith de la raíz tras resolve / lista blanca SAFE_NAME;
  aserciones de contrato para variables de entorno de tipo directorio: ruta absoluta sin segmentos `..`).

## [0.8.5] — 2026-08-23

### Corregidos

- **Rectificación del criterio de puntuación** (bench): ① en las preguntas con stale (actualización/cadena/olvido), la condición de FAIL pasa de «aparece el valor viejo» a «el valor viejo **enunciado como situación vigente**» — el mero relato de la evolución con valor final correcto ya no penaliza
  (medido en el retorno lifecycle del 2026-08-23: una pregunta de cadena con respuesta correcta sobre platino/diamante que, sin embargo, mencionaba la trayectoria de la arena para gatos, era masacrada por entero); ② el FAIL de las preguntas de negativa a responder se limita a «pronunciar como hecho conocido justo lo que se preguntaba», citar el contexto real para explicar «por qué lo preguntado se desconoce» cuenta como PASS («solo conozco A y B, no hay registro de C» antes se descartaba en balde). La pregunta update de work-project-stack pasa de contains-all al juicio del LLM (el juicio programático no sabe distinguir el enunciado vigente del relato de evolución; ya no hay combinaciones contains-all+stale en toda la biblioteca).
- **Etiquetado erróneo de familia en la modalidad auto: hechos personales «de plan» aspirados a la familia work** (descubierto en la primera corrida de la pista lifecycle):
  el prefijo de tipo de la salida de la extracción decidía a hurtadillas la familia, y hechos personales de forma «regla» como «plan antiparasitario / calendario de vacunas / elección del arenado», sin fórmula que encajara en el vocabulario chat, eran aspirados por la semántica de forma de work_fact/work_method → familia mal etiquetada → el mismo hecho en doble familia (la deduplicación nunca cruza familias → resurrección del valor viejo, fracaso de las preguntas en cadena) + fuga del filtrado por familia (una sesión en modalidad chat podía nombrar hechos work, 2/2×2 medidos en lifecycle). Arreglo: el prompt de extracción de la modalidad auto **emite expresamente un campo family por memoria** (el juicio mira el contexto, no la forma — profesión/equipo/proyecto → work, familia/mascotas/salud/agenda personal → chat; family circunscribe el vocabulario de tipos, sin cruces); lado ingeniería, cadena de repliegue de tres peldaños `resolveRecordFamily` (puro forzado → expreso de la extracción → prefijo de tipo). La divergencia respecto al upstream MemoryCore está anotada en la cabecera del prompt. **Una base mal etiquetada hay que reconstruirla una vez tras la actualización para sanarla** (L1 vaciado y reimportado; atención: el rebuild resucita de L0 los hechos «olvidados» — semántica ya existente).

### Añadidos

- **Completar el triángulo de eficiencia** (bench + plugin): «el coste de la memoria» y el «ahorro por memoria» ya medido de la pista workflow componen un ROI completo —
  ① **coste de inyección** (diferencial de respuesta entre turnos inyectados y no inyectados — las marcas de tiempo de los eventos se escriben al repartir los pasos, el tiempo propio del gancho de inyección no es directamente observable, de ahí el paso al criterio diferencial tras la verificación en campo;
  el grupo A se hace su propia base por dentro); ② **cuota inyectada** (caracteres inyectados del turno sonda / tokens de entrada del turno, convirtiendo 1 carácter chino ≈ 1 token); ③ **contabilidad de destilación** (nuevo contador siempre encendido `src/llm-usage.ts`, callLLM acumula por capa l1-extract/l1-dedup/l2/l3 los caracteres de entrada/tokens de salida/de razonamiento, legible vía servicio de control bench
  `getDistillUsage`, prorrateado por cada mensaje capturado; el rebuild del lifecycle tiene además su propio diferencial antes/después). patch-arm-on enciende al paso benchControl; las corridas viejas sin los campos nuevos se saltan automáticamente la sección.
  De paso se tapa un hueco en la guardia de enlaces de run.mjs: los worktree hermanos bajo el árbol principal (.worktree/…) antes
  se dejaban pasar — medido el 2026-08-23, un viejo runner que apuntaba a .worktree/dev recorrió todo el proceso en silencio.
- **Pista de ciclo de vida** (bench `--track lifecycle`, solo grupo A): pone a prueba solo los invariantes del ciclo de vida que solo esta arquitectura puede probar —
  **filtrado por familia** (una sesión en modalidad chat no puede nombrar hechos de la familia work, y en espejo; una fuga entre familias no nula significaría que «escritura y recuerdo en la misma modalidad» están rotos), **captura en modalidad apagada** (doble aserción: los hechos nonce enseñados a una sesión apagada — la sonda auto debe negarse a responder + ausencia íntegra en los JSONL records/conversations, reverificada tras el rebuild), **fidelidad del rebuild** (tras la reconstrucción íntegra, sonda ×2, control ×1; un retroceso significativo significaría que la cadena del rebuild pierde información), **peticiones de olvido** (pedir en conversación natural borrar un recuerdo → vía de borrado de la detección de conflictos L1 → repetir la misma pregunta debe dar un rechazo sin repetir el valor viejo; la resurrección por rebuild de los hechos viejos desde L0 es la semántica documentada). Cero archivos de escena nuevos, reutilización de la biblioteca de diálogos.
- **Curva de degradación a escala**: ① anegamiento sin conexión (`retrieval-metrics.mjs --flood N1,N2`) — duplicar la base de referencia con N registros sintéticos deterministas (dominios temáticos desplazados, en el texto completo cero cifras para evitar choques fortuitos con los gold numéricos) y recalcular recall@k, una curva «calidad de búsqueda vs volumen de la base» sin coste de ejecución (base de archivo 0.8.3 medida: +400 entradas → recall@5 de 70,2% a 65,8%); ② ruido en ejecución (run.mjs `--noise k`) — entre las escenas de diálogo se insertan sesiones de relleno (`fillers.json`, 25 sesiones, aserción de carga contra las colisiones de marcadores) para medir la degradación extremo a extremo; el report recibe una sección «análisis de posición a escala» (tres cubos inicio/medio/final); el relleno no toca la lista scenarioFiles, los compare entre grados de noise no levantan avisos de entorno.
- **Servicio de control bench** (configuración `benchControl` del plugin, apagada por defecto): un servicio cordis en proceso `dsh-memory-bench` (disparo de rebuild / sondeo de estado / fijación de modalidades de sesión) al servicio de la pista lifecycle — del lado host, connection.rpc tiene solo handle y no call; este es el único canal intraproceso limpio; los despliegues de producción no abren esta configuración, superficie nula.
- **Indicadores sin conexión de la capa de búsqueda de la referencia** (bench): calculados automáticamente por report/compare + CLI autónoma
  (`bench/harness/retrieval-metrics.mjs`) — tablas por tipo de pregunta para recall@5 / cobertura de gold / MRR (las preguntas sonda rehechas de modo controlado con la búsqueda keyword sobre la base de memoria final del rep, criterios de vaso/umbrales/excepciones de corpus pequeño y de ejecución idénticos punto por punto, la tokenización y el índice comparten los search-utils de dist) + precisión de inyección (cuota de las líneas inyectadas con los puntos gold) + recuento de inyecciones con información ya caducada (los stale de tipo update entran en la inyección, el fracaso de la actualización se ve justo en la capa de inyección). El runner anota además `recall.lines` (detalle de las líneas de memoria inyectadas).
  Al problema del arma contusa «precisión de extremo a extremo» he aquí un mensaje directo, que no depende del juez ni del muestreo.
- **Cuatro nuevos tipos de pregunta + escenas de workflow con memoria prospectiva** (bench, inspirados en MemoryAgentBench /
  GoodAI LTM / BEAM): `accretive` (acumulación incremental: un hecho completo repartido en varias sesiones a montar),
  `update-chain` (actualización en cadena v1→v2→v3, con cadenas de retorno), `ordering` (ordenación de eventos),
  `paraphrase` (reformulación sinónima a prueba de las grietas léxicas) — biblioteca de diálogos 15→20 (escenas nuevas todas en formato de 10 preguntas,
  90→140 preguntas por rep), las escenas pueden llevar sesiones de refuerzo (0~2, encajadas entre teach y change); en workflow nuevo `wf-preflight`
  (convención fija enseñada «antes de generar, escribe primero el archivo de pre-vuelo», la sonda da solo una tarea vaga, el grupo A ha de completar el paso fiándose de la memoria).

### Cambios

- Actualización de las reglas del validador de escenas de diálogo: número de preguntas sonda 6→6~10 (las seis centrales exactamente 1 cada una + como mucho 1 por tipo extendido),
  sesiones de refuerzo permitidas (orden forzado teach → reinforce → change),
  `update-chain` debe llevar stale; el criterio especial de actualización confluye en las preguntas en cadena.
  El cambio de lista de escenas hace que los compare con las bases viejas avisen «entorno no conforme» — esperado; vuelve a correr la base o apunta `--scenarios` al mismo subconjunto para comparar.

## [0.8.4] — 2026-08-22

### Corregidos

- **El nuevo vocabulario de niveles de razonamiento de la página de ajustes era rechazado por la guardia de escritura** (introducido en 0.8.3): al ensancharse la tabla de niveles a ocho palabras, la lista blanca RPC de `settings-set` no lo siguió (solo reconocía `''/off/high/max`), y la página de ajustes respondía a cada elección de `none/minimal/low/medium/xhigh` con «nivel de razonamiento ilegítimo» y se volvía atrás. Ahora la lista blanca y el schema/settings tiran de la misma fuente — el vocabulario converge a la única fuente de verdad `EFFORT_CHOICES` de `config.ts` (antes la misma lista estaba copiada a la letra en 4 lugares).
- **El presupuesto de salida expreso `xhigh` se engordaba dos veces, ×16** (introducido en 0.8.3): el `layerMaxTokens` del lado de las fases y la guardia de la modalidad automática de `callLLM` llevaban cada una su propia tabla literal de los niveles altos y divergían (la guardia olvidaba `xhigh`); con la configuración `xhigh` y un modelo que lo declara, se multiplicaba ×4 y otra vez ×4. Los dos lados comparten ahora la única constante `HIGH_EFFORT_TIERS`, y cuando la configuración es ella misma un nivel alto, la guardia ya no engorda.
- **El selector de nivel de razonamiento recupera la entrada «Auto»**: tras quitar la opción «sigue la configuración» en 0.8.3, el selector solo mostraba los niveles declarados del modelo, y quien una vez hubiera elegido un nivel expreso no podía volver al automático desde la UI. La primera entrada está ahora fijada «Auto» (key='', el clic reescribe la cadena vacía), y la triple repetición en la construcción de las opciones converge en un único cálculo.
- Deriva documental: la lista de valores de `llm.reasoningEffort` en ambos README recibe `minimal` (alineada con el schema); las menciones «high/max ×4» en los avisos de presupuesto de la página de ajustes y en los comentarios del código se completan a high/xhigh/max.

### Cambios

- **Actualización del runtime del host 0.1.0-rc.8 → 0.1.1-rc.2** (devDeps fijadas con precisión, peers pasados a la línea `^0.1.1-rc.2`): los 9 paquetes de dependencias directas comparados archivo por archivo en el tarball — 7 paquetes sin cambio de código,
  dsh-llm / dsh-client-connection a puro incremento (descarga de imágenes multimodales / Files API /
  `prepareCall` del adaptador / parámetro opcional RPC `doFetch`), los GenerateOptions/StreamChunk/createUserMessage/installModelSelection/
  rpc.handle|call usados por este proyecto son idénticos byte a byte, cero adaptaciones. Verificación: build/smoke/dump-config de ambos perfiles/
  smoke del fixture de bench todo verde. El ERESOLVE de npm al atravesar familias pre-release pasa por `--legacy-peer-deps` (anotado en AGENTS.md).

### Referencia

- **La pista workflow de DSH-MemBench crece a 7 escenas** (`bench/`), con tres nuevas familias de pruebas:
  actualización del saber de proceso (`wf-heap-update` — enseñanza v1 → sesión de cambio que anuncia la v2 → sonda sobre
  «el proceso vigente ahora», los artefactos propios del proceso viejo no deben volver a aparecer, medida operacionalizada de la actualización por deduplicación L1),
  desambiguación de workflows gemelos (`wf-twin-runbook` — runbook gemelos, configurar el servicio equivocado lo condenan las comprobaciones negativas),
  continuidad de las convenciones de estilo (`wf-report-style` — convenciones de denominación/estructura/separador de miles/pie de página llevadas de sesión en sesión). La verificación de completitud se ensancha de una sola comprobación positiva a cuatro tipos de criterios (`contains`/`notContains`/
  `absent`/`exists`), el verificador se extrae a `checks.js` unitestable aislado; el runner admite una sesión `change` opcional; la validación de la biblioteca de escenas se cierra al mismo tiempo (exactamente un criterio a elegir, el marcador debe figurar en el texto de enseñanza).
  La base oficial (`bench/baseline/`) queda en la versión de 4 escenas; la primera corrida de regresión tras el ensanche tendrá que reconstruir la base.

### Endurecimiento de la referencia (lote de correcciones tras la auditoría de huecos)

- **Grupos A y B en paralelo**: `run.mjs --arm AB` corre ambos grupos en dos procesos paralelos (los controles no cuelgan el uno del otro), el padre al final emite el informe conjunto; los hijos quedan exentos de limpieza y de informe automático para no estorbarse.
- **Taponado del canal de arqueología entre corridas**: antes de cada corrida se barren las sandboxes históricas de `%TEMP%/dsh-mem-bench/` y los directorios de sesiones del namespace bench en `~/.dsh/sessions` (solo se cruza `dsh-mem-bench`, las sesiones/datos del usuario no se tocan).
- **Retirada del grupo B de la pista de diálogo**: las sesiones de Harness son independientes entre sí, la sonda del grupo B sin memoria fracasa necesariamente (históricamente 17,8% ≈ el suelo), el control no informa de nada — `--track dialog --arm B` se niega a correr, solo queda el grupo A.
- **Huella del código y guardia de enlaces**: la cabecera environment de los resultados anota `gitSha`; run.mjs comprueba al arrancar que las dos dependencias link: del perfil bench apuntan al repositorio probado (el código de un worktree viejo contaminaba silenciosamente los resultados, accidente medido el 2026-08-21).
- **Auditoría a dos niveles de las lecturas fuera de frontera** (pista workflow): nivel estricto — un acierto (base de memoria/sesiones de `~/.dsh`, memory.db, rutas de almacenamiento records/conversations/scenes) → todas las comprobaciones de las escenas implicadas quedan condenadas; laxo — solo se pide reverificar;
  arreglo del falso aviso por la subcadena `.MemoryMappedFiles`; las llamadas legítimas de herramientas de memoria (memory_read_scene etc., los parámetros son rutas) no entran en la auditoría.
- **De-autorrevelación de las escenas**: `wf-heap-update` pasa a una convención de dos pasos `target.env + apply.sh`, `wf-twin-runbook` a archivos `svc-a/svc-b` isomorfos (la correspondencia vive solo en el texto de enseñanza) — arreglo del hueco de discriminabilidad «el grupo B puede hurgar los archivos de la sandbox y reconstruir el proceso» (medido, la sonda B había llegado a 12/12 y 11/12, casi la nota máxima).
- **Contaminación del workflow medida**: la inyección de recuerdo de las sondas de workflow entra en las estadísticas de contaminación (el campo faltaba, el report mostraba 0); el report recibe una columna **completitud del segmento sonda** (en los segmentos de enseñanza/cambio ambos brazos tienen el contexto a mano; solo el segmento sonda es la ventana de memoria pura).
- **Cierre de la validación de la biblioteca de escenas**: marcadores únicos en toda la biblioteca, búsqueda de duplicados entre sesiones del mismo tipo, los gold de contains-all deben figurar en el texto de enseñanza (pregunta sin respuesta sin memoria = mala pregunta), los gold no deben filtrarse en el texto de las preguntas; la detección de llamadas de socorro recibe patrones ingleses; los fixtures se separan por pista en `dialog/`, `workflow/` (una escena workflow bajo un patch de diálogo sin herramientas fracasaría seguro, el smoke mezclado habría avisado en falso).

### Ergonomía de la referencia (configuración de modelos vía bench.env)

- **Configuración concentrada de los modelos en tres roles**: `bench/harness/bench.env` (plantilla copiada de `bench.env.example`, con clave API en gitignore) configura en un solo lugar el agente probado / el juez / la destilación —
  `BENCH_PROVIDER/BENCH_MODEL`, `BENCH_JUDGE_*`, `BENCH_DISTILL_*`; los argumentos de línea de comandos pisan el archivo env. Nuevos parámetros `--distill-provider/--distill-model`, el modelo de destilación pasa del código fijado en el patch a las variables de entorno (repliegue por defecto: official/flash).
- **Pasarela personalizada compatible con OpenAI**: tras rellenar en bench.env `BENCH_TEST_BASE_URL + API_KEY` (el juez puede tener otra pareja), run.mjs genera automáticamente el patch llm-pi-ai que registra `bench-gw` /
  `bench-judge-gw` (juez/destilación que reutilizan la pasarela probada: fusión y deduplicación automáticas de la tabla de modelos), la clave API referenciada por apiKeyEnv se inyecta solo en el entorno del proceso hijo. Con la pasarela configurada, los proveedores personalizados de la corrida los dicta por entero bench.env (la pasarela del settings.yaml del usuario no participa: aislamiento y reproducibilidad).
- **Retirada del repliegue por defecto del modelo probado**: sin `--provider/--model` y sin bench.env, se niega a correr (el viejo repliegue caía en el modelo por defecto del settings.yaml, y el perfil bench sin adaptador explotaba al arrancar).
- El análisis y la construcción del patch de pasarela se extraen al módulo de funciones puras `env-config.mjs` (22 unit tests + verificación estructural de dump-config, todo verde).
- **Intensidad de razonamiento configurable en tres roles**: `BENCH_REASONING_EFFORT` (probado) / `BENCH_JUDGE_REASONING_EFFORT`
  (juez) / `BENCH_DISTILL_REASONING_EFFORT` (destilación, por defecto off) + parámetros correspondientes `--effort/
  --judge-effort/--distill-effort`; transmitidos vía `ModelSelection.reasoningEffort`
  (puerta oficial installModelSelection) y las GenerateOptions del juez; vacío = no transmitir, seguir el predeterminado del proveedor; la cabecera environment de los resultados anota el effort de ambos lados (reproducibilidad).

### Actualización de los datos medidos de la referencia (README en chino/inglés sincronizados)

- **Nuevos datos tras el ensanche de la pista workflow a 7 escenas** (v4-flash@high, juez glm-5.3, plugin 0.8.3):
  completitud del segmento sonda grupo A (memoria encendida, 3 turnos) **85,5%** (59/69) frente al grupo B (memoria apagada, 1 turno)
  **43,5%** (10/23); los tokens de entrada del grupo B por escena valen **6,8 veces** los del grupo A (1,81M frente a 266k,
  a nivel high el precio de la reexploración sin memoria se hincha notablemente); sonda de la escena de convenciones de estilo grupo B 0/4 (las convenciones
  viven solo en la memoria, el techo de la discriminabilidad); en la escena de actualización del proceso el grupo B aún puede reconstruir leyendo los scripts (discriminabilidad limitada por las
  affordances de la sandbox, anotado honestamente en el README). El gráfico `bench-workflow.svg` se rehace con los datos nuevos; los datos viejos de la pista
  de diálogo se etiquetan base de archivo 0.8.0 (grupo B retirado).
- **Barandilla de coste del grupo B**: `--repeats` solo actúa sobre el grupo A, el grupo B corre fijo solo 1 vez (el gasto en tokens de las tareas largas
  sin memoria es demasiado alto, decisión del usuario).
- **Panel de progreso en tiempo real**: al arrancar la referencia, `run.mjs` levanta automáticamente `panel.mjs` (cero dependencias, atado solo a
  127.0.0.1) y abre el navegador — cartas de ambos brazos A/B, progreso de grano fino por escenas/fases/mensajes, coste acumulado,
  cola de eventos; el par de indicadores latido (5 s) + frescura de la actividad decide al vuelo «colgado vs proceso muerto». La fuente de datos es la escritura atómica incremental del runner en `rep-N/progress.json` (estrangulada a ≥ 1 s) + el `plan.json`
  al arranque de `run.mjs` (el ciclo de reps queda en el padre, los hijos ignoran el total). `--no-panel` desactiva;
  el panel se siega automáticamente al terminar la corrida (unref de los hijos, si no, retendrían la event loop del padre).

## [0.8.3] — 2026-08-21

### Cambios

- **Los niveles de razonamiento de la destilación se vuelven conscientes del modelo (arregla la explosión garantizada de la destilación en modelos no deepseek)**: antes el plugin transmitía el nivel de razonamiento de la destilación (por defecto `off`) tal cual a cualquier modelo — `off` es un concepto de la capa adaptadora deepseek, desconocido de las pasarelas pi-ai/openai-responses (qwen en local rechazaba, desde arriba llegaba un 400 Invalid
  reasoning.effort). Ahora, antes de enviar, se interroga por `resolveModelInfo` las capacidades del modelo (caché por ruta, invalidada al cambiar la topología): declarado → se envía tal cual; `off` ante el vocabulario OpenAI → alias `none`; no soportado o no declarado → no se envía + un solo aviso; **la opción «sigue la configuración» se retira**, '' = auto (nivel por defecto del modelo →
  high); la tabla de niveles elegibles de la página de ajustes sigue la muestra en directo del modelo actual (sin declaraciones, solo high visible); el vocabulario de la tabla se ensancha a off/none/minimal/low/medium/high/xhigh/max; si el nivel auto se resuelve en uno alto, la guardia ×4 del presupuesto de salida entra en juego al mismo tiempo.
- **Cambio del modelo de destilación con selección automática del modelo**: tras cambiar de proveedor, el modelo recae automáticamente en el primer modelo del proveedor (escritura en pareja con sobreescritura), el desplegable del modelo ya no tiene «sigue el por defecto» (seguir el por defecto = vaciar la primera entrada del desplegable del proveedor sobreescribiéndola);
  la lista de modelos se guarda en caché por proveedor + se precarga en segundo plano al abrir el panel (cambio instantáneo sin huecos; en caso de fallo se muestra «cargando la lista de modelos…» en vez del nombre de un modelo rancio). **El texto del botón que no cambiaba solo, ahora arreglado**: el optimismo de `writeLlm` fundía antes las claves de ajustes `distillProvider/distillModel` directamente en `info.current`,
  mientras la capa de visualización leía `current.provider/model` — las claves no coincidían, el optimismo era un no-op para el texto del botón,
  y había que esperar el refresco por sondeo de 5 s (sensación de «unos segundos antes de que cambie»); ahora las claves se mapean a claves de vista y se escriben a la vez en `current` y
  `effective`, las respuestas rancias del sondeo llegadas durante la escritura en vuelo se descartan (contra el parpadeo), y tras el éxito se tira una vez del valor verdadero del servidor.
- **Desplegable dibujado por entero por dentro, alineado con el aspecto del MenuDropdown de dsh**: la lista desplegada del `<select>` nativo la pinta el sistema operativo (esquinas rectas, resalte del sistema), fuera del alcance del CSS — sustituido por botón-disparador + panel flotante (redondeo de 12px
  / fondo dsw-specific-menu / sombra lv3, entradas con redondeo de 10px + fondo al pasar + marca de selección,
  teclado ↑↓/Enter/Esc soportado por entero, semántica aria listbox). Los cuatro lugares — los dos niveles proveedor/modelo del modelo de destilación y los filtros tipo/contexo de la pestaña de memoria — están todos sustituidos, en el bundle ya no queda ningún `<select>` nativo.
- **Los bloques de escena de la página de ajustes se pliegan**: las cartas de escena de la pestaña de escenas van plegadas por defecto (solo la cabeza + una línea de resumen),
  un clic en la cabeza despliega/pliega el cuerpo, la flecha de plegado en estado desplegado gira 90° (respeta reduced-motion).
- **La pestaña de registros rueda por defecto hasta abajo**: leer los registros es querer la cola más reciente (semántica tail); tras cargar/refrescar se pega automáticamente al fondo, ya no se queda parada por defecto arriba.
- **Guía de desbloqueo cuando el despliegue está fijado**: cuando el modelo de destilación está encerrado por el pin estático del perfil (`llm.provider`+
  `llm.model` ambos llenos) y el selector no aparece, un texto estático explica «cómo quitar el pin para recuperar
  la conmutación desde la página» (antes solo se mostraba la ruta fija, el usuario no sabía por qué no podía conmutar).

Lote de correcciones tras una revisión completa del código (seguridad + robustez + coherencia documental).

### Corregidos

- **Una configuración de proxy malformada ya no derrumba la carga del plugin** (alta gravedad): si `embedding.proxy` está escrito sin esquema
  (p. ej. `127.0.0.1:7890`) o la propia variable de entorno del proxy carece de esquema, el constructor de `ProxyAgent` lanzaba un TypeError de forma sincrónica → apply fracasaba. Ahora la misma tolerancia que con el espejo malformado: captura y repliegue a conexión directa + warn.
- **Censura de las URL de proxy en los logs**: el log de descargas vía proxy imprimía antes la URL del proxy tal cual (con posibles
  credenciales user:pass) y las persistía en `memory.log`; ahora se despojan las userinfo, solo queda `scheme//host`.
- **`NO_PROXY=*` con asterisco universal toma efecto** (antes la entrada `*` nunca cruzaba, el proxy seguía en uso aunque estuviera puesto).
- **Ciclo cerrado de la visibilidad de los fallos de doble escritura**: el fallo de L0/L1 «fuente de verdad JSONL escrita, escritura por lotes en la base de búsqueda fracasada» antes era silencioso
  (registros desde entonces introvables, candidatos de deduplicación ausentes); ahora se eleva a log error con la nota de que «Reconstruir memoria» permite reimportar todo desde la fuente de verdad.
- **Durabilidad de las escrituras atómicas**: las escrituras atómicas tmp+rename de state/pending/escenas/persona reciben el fsync del bloque de datos
  (antes un apagón podía dejar un archivo vacío o a medias); el nombre del tmp recibe un segmento aleatorio contra las colisiones en el mismo milisegundo, el camino de fallo limpia los tmp huérfanos.
- **Semántica de cancelación del instalador de ejecución** (plataforma principal Windows): tras la cancelación en la fase ci, ya no se cae en el ramal de repliegue «ci fallido» con un install inútil repetido; la cancelación en la brecha entre la salida del ci y el arranque del repliegue también cuenta; bajo `shell:true` el kill pasa a `taskkill /T /F` por el árbol de procesos (antes solo se mataba cmd.exe y los nietos de npm seguían corriendo — timeout y cancelación paraban solo en la superficie).
- **Configuración de corte de lectura para el embedding local**: `embedding.maxInputChars` valía antes solo para el embedding remoto, la vía local codificaba 5000 a mano; las dos vías tiran ahora de la misma fuente.
- **Endurecimiento de los nombres de archivo de escena**: los nombres de dispositivos reservados de Windows (CON/NUL/COM1… en forma con extensión) reciben un prefijo `_` de escaqueo; los nombres excesivamente largos se cortan a 120 caracteres (defensa frente a ENAMETOOLONG).
- **Criterio de migración del formato viejo L1**: si en el viejo `records.jsonl` había líneas malas, la migración nunca terminaba (la misma remesa se reimportaba a cada arranque); el criterio pasa al número de líneas válidas tras el filtro.
- **Límites de los parámetros de entrada RPC**: sessionId ≤ 512 / query ≤ 4096 / provider·model·activeModel ≤ 200,
  offset de paginación ≤ 1 millón — contra las cargas desmedidas malformadas desde el panel en loopback (hinchazón de session-modes.json, picos de CPU de la tokenización jieba íntegra).
- **Guardias de limit para las búsquedas FTS/vector**: las tres entradas de búsqueda rechazan `limit ≤ 0` (LIMIT negativo en SQLite = sin límites; la cara de llamadas actual ya está morseteada, pura defensa ante futuros llamantes).
- **Aviso ante llamadas de herramienta sin identificador de agente**: sin `exec.agent` transmitido, el filtro por modalidad degradaba a búsqueda de todas las familias; ahora un solo aviso (el comportamiento fail-open se conserva, la llamada no se rechaza).

### Documentación

- El README chino recupera la sección entera «Registros y resolución de problemas» que existía solo en la versión inglesa (una brecha que violaba la ley del sincronismo chino-inglés),
  ambas versiones añaden a la vez la explicación del límite de durabilidad del JSONL; la versión fijada en los ejemplos pasa de 0.8.0 a 0.8.2.
- **Dos errores fácticos de la entrada 0.8.2 corregidos**: ① el intervalo peer en realidad quedó en `^0.1.0-rc.6` (rc.6~rc.8 compatibles), «la exigencia peer pasó a dsh ≥ 0.1.0-rc.8» no correspondía con el package.json; ② el documento citado
  `docs/dsh-dev-experience.md` no se distribuye con el repositorio (gitignored), hacia fuera una referencia colgante.

## [0.8.2] — 2026-08-20

Alcance de las dependencias del host hasta dsh 0.1.0-rc.8.

- **Actualización clavada de las dependencias del host 0.1.0-rc.6 → 0.1.0-rc.8** (devDependencies fijadas con precisión, para
  desarrollo/test; las peerDependencies se quedan en el intervalo `^0.1.0-rc.6` — rc.6→rc.8 probadas en la práctica como **cero deriva
  de API**, compilación de tipos/smoke/arranque real todo verde). Desde rc.8 el cuerpo de dsh pasa a una disposición de **instalación global**
  (`profiles/node_modules` mantenida por el mecanismo de heal como una granja de enlaces simbólicos); la vieja instalación «de árbol material» caía al arrancar.
- bench `run.mjs`: la entrada de la CLI dsh pasa a ser una cadena de resolución (`DSH_BIN` → prefijo global de npm → repliegue a la disposición vieja),
  quitadas las rutas personales fijadas a mano, ejecutable directamente en otras máquinas.

## [0.8.1] — 2026-08-20

Conmutación en ejecución del modelo de destilación + reintentos anti-contaminación de las descargas de modelos + DSH-MemBench v3.

### Añadidos

- **Ajuste en ejecución del presupuesto de salida de la destilación** (página de ajustes → Memoria → Resumen → Parámetros de destilación → presupuesto de salida):
  los techos de token de las cuatro capas — extracción / deduplicación / escena L2 / perfil L3 — pasan a ser regulables desde la UI (antes eran constantes del código; cualquier ajuste exigía tocar el archivo de configuración y reinstalar); vacío o 0 = seguir los predeterminados integrados (16k/8k/32k/16k),
  el engordamiento ×4 de los niveles de razonamiento high/max se aplica como siempre sobre el valor eficaz. El panel de interruptores de la página de ajustes se rearma al paso en dos grupos «modalidad de memoria / parámetros de destilación», agrupación de opciones más legible.
- **Ajuste en ejecución del presupuesto de entrada de la destilación** (el mismo grupo → presupuesto de entrada): el techo de caracteres de entrada de una llamada de destilación
  (`llm.maxInputChars`, por defecto 700.000) pasa a ser regulable desde la UI, vacío/0 = seguir la configuración estática; la división en bloques de la extracción L1, el corte L2/L3 y la estimación del número de llamadas de la reconstrucción siguen toda la cadena por el valor eficaz.
- **Conmutación en ejecución del modelo de destilación** (página de ajustes → Memoria → Resumen → selector «modelo de destilación»): elección del provider/model de destilación entre las **rutas de proveedores configuradas** del host
  (incluidos los proveedores OpenAI-compatibles personalizados añadidos en dsh → ajustes → modelos), efecto inmediato, sin reinicio, se conserva entre reinicios. Prioridad:
  pin estático del despliegue (`llm.provider`+`llm.model` ambos llenos, contra una elección del usuario que mande las conversaciones fuera)
  > elección en ejecución > modelo por defecto. Nuevos endpoints RPC `dsh-memory/llm-providers`
  (catálogo de proveedores + elección por defecto + sobreescritura actual + ruta realmente eficaz + está registrado todavía el proveedor elegido)
  y `dsh-memory/llm-models` (modelos por proveedor; si el adaptador no da catálogo, la UI degrada a tecleo manual);
  tras borrarse proveedor/modelo, la UI señala expresamente «fuera de la lista» e invita a reelegir.

### Corregidos

- **EmbeddingGemma no se instalaba** (causa raíz verdadera): el sha256 de `generation_config.json` del catálogo estaba transcrito con un carácter equivocado (`a736d1b3` en vez de `a736b1b3`) — el espejo jamás devolvió ni un byte fallido, lo erróneo era el propio contrato de integridad; la descarga caía con seguridad con «verificación sha256 fallida», sin nada a que asirse. Corregido según las mediciones, y las 19 archivos del catálogo pasaron una verificación autoritativa (archivos LFS cotejados con los oid de la tree API de HF, los archivos pequeños hachados de verdad) — todo lo demás concuerda. Nuevo `npm run verify-catalog`
  (`scripts/verify-catalog.mjs`) para reverificar de un clic en cada alzada del catálogo, para excluir accidentes de transcripción de la misma casta.
- **Descargas de modelos que no conectan/lentas** (cuestión concomitante, medida en el mismo escenario): el acceso directo al espejo es intermitente en las redes chinas (alternan timeouts TCP y ventanas alcanzables), y el fetch de Node no lee las variables de entorno del proxy —
  el descargador ahora soporta proxies (nueva configuración de tres estados `embedding.proxy`: por defecto detección automática de las
  `HTTPS_PROXY`/`ALL_PROXY` etc. respetando `NO_PROXY`, `none` fuerza la conexión directa,
  o URL de proxy expresa; pasa por el `ProxyAgent` de undici, la misma semántica que curl/npm).
- **Resiliencia del descargador**: reintento automático al fallar un archivo (2 veces por defecto, con intervalos de 1 s/3 s) y en cada reintento añadido de
  `?dshmem-retry=N` para cambiar la clave de caché — dentro de la ventana de un objeto de caché corrompido en el CDN del espejo, la misma URL recibe de modo determinista la misma mala respuesta; solo el cambio de clave saca otro objeto y se autocura. Verificación no conforme → descarga desde cero (el punto de reanudación contaminado borrado),
  recuento de archivos no conforme/error de red → se conserva la reanudación; la cancelación no se toca; la semántica de reanudación entre procesos no cambia.

### Referencia y documentación

- **DSH-MemBench v3** (`bench/`): pista de diálogo (15 escenas × 6 tipos × 3 pasadas
  = 270 preguntas/grupo) + pista workflow (4 escenas en sandbox de herramientas real) como doble vía ferroviaria de contraste A/B — **grupo A (memoria
  encendida) frente a grupo B (memoria apagada)**, la misma biblioteca de escenas, entradas idénticas palabra por palabra, pilotaje automático sin cabeza (perfil dsh headless + plugin runner local), puntuación a dos niveles programa/LLM; indicadores de integridad completos: detección de contaminación entre escenas (barrido de los marcadores de escena), auditoría de excesos de herramientas, cuota de caché a régimen (sin las primeras peticiones de sesión), prueba especial de actualización del conocimiento (tras cambiar de parecer, nombrar lo viejo = 0) y prueba especial de negativa a responder (inventar = 0). `run.mjs` corre A/B con un comando,
  `report.mjs` produce el informe estructurado, `compare.mjs` sirve a los contrastes de regresión antes/después de cambiar el plugin;
  la base oficial (resultados íntegros de las dos vías × A/B × 3 pasadas) queda en `bench/baseline/`. El viejo escenario manual agentic (v2) se ha retirado.
- **La sección «comparación medida» del README se llena de números reales** (chino/inglés sincronizados): pista de diálogo, precisión total del grupo A 92,6%
  (250/270) frente al grupo B 17,8% (48/270), cero invenciones de ambas partes; desglose del doble canal de recuerdo (75,1% de aciertos por inyección pasiva + 84 preguntas en consulta activa, 60 preguntas salvadas por las herramientas de memoria); pista workflow, el grupo B paga +49% de pasos / +61% de llamadas de herramienta / +43% de tokens de entrada, escena de inicio de sesión +88% de entrada (las credenciales viven solo en la memoria, el grupo B repregunta al usuario en cada turno). Las tablas de mediciones pasan a gráficos SVG (`bench-dialog` /
  `bench-workflow`), todas las ilustraciones SVG del README toman la nueva vestimenta oro/azul profundo (`flow` /
  `storage` sincronizados).

## [0.8.0] — 2026-08-18

Paquete de optimización de la memoria (decisiones registradas ADR-0001/0002/0003):
inyección del recuerdo por el lado de los mensajes + retrazo de los disparadores de destilación (umbral progresivo + aislamiento de sesiones por toda la cadena) + presupuestos de salida por capa + arreglo de la vía de escritura FTS.

### Añadidos

- **Inyección del recuerdo por el lado de los mensajes** (ADR-0001): las memorias relevantes se vierten al flujo como un mensaje sintético firmado por el plugin (`form: 'recall'`,
  la UI del host muestra la línea de firma **«context injection · memory»**) colocado antes de cada nuevo mensaje del usuario
  — el usuario comprueba con sus propios ojos que «la memoria actuó». Etiqueta `<relevant-memories>` + frase de escolta «solo a título orientativo»; los pasos de herramientas puras / decisiones reject se transmiten tal cual; disparo solo en los pasos con nuevo mensaje del usuario
  (comienzo del turno + interrupciones de timón). La guía de herramientas precisa que en los entornos restringidos (como la modalidad code-runtime, que solo admite la entrada de ejecución de código) las herramientas de memoria hay que usarlas indirectamente por el mecanismo de llamada de esa entorno. El prompt del sistema conserva solo el contenido estable
  (perfil/navegación/guía de filtrado), la ranura dinámica `memory:recall` se retira;
- **Presupuesto del recuerdo**: `recall.maxCharsPerMemory` (por defecto 500) / `recall.maxTotalRecallChars`
  (por defecto 2000) — al pasarse, recorte con la escolta `… (recortado; detalles vía memory_search o conversation_search
  )`, que embaula al modelo hacia las herramientas por el texto íntegro (el recorte es un embudo: la vía de las herramientas devuelve el registro completo); pasado el total se pierde la cola de baja puntuación; recorte seguro a nivel de code point;
- **Vencimiento del recuerdo**: `recall.timeoutMs` (por defecto 5000, 0 = ilimitado) como presupuesto total, al pasarse se salta el turno de inyección;
  morseteo interno del fetch del embedding remoto a 3000 ms (para dejar tiempo a la bajada FTS), la inferencia local no se morsetea;
- **Umbral progresivo de la destilación** (ADR-0003): el umbral eficaz trepa 1→2→4→a régimen (la semántica de `extract.minMessages`
  pasa a ser umbral a régimen, predeterminado 1→6) — los usuarios nuevos consiguen una memoria ya en el primer turno, a régimen el apilado por lotes ahorra llamadas; el estado de la trepada se persiste con pending.json;
- **Red de inactividad**: `extract.idleSeconds` (por defecto 300, 0 = desactivado) — cuando la sesión guardó el silencio debido, las rodajas sin destilar
  caen en el saco automáticamente; las sesiones apagadas con rodajas en espera se saltan;
- **Sincronización de rodajas al cambiar de modalidad**: cambio entre modalidades no apagadas → las rodajas de esa sesión se destilan enseguida según la modalidad de captura; cambio a apagada → aplazamiento; regreso desde apagada → las rodajas aplazadas caen según la modalidad de captura (las rodajas jamás se mezclan entre modalidades);
- **Presupuestos de salida por capa**: extracción 16k / deduplicación 8k / L2 32k / L3 16k; ×4 automático en los niveles de razonamiento high/max
  (guardia contra el accidente histórico del reasoning que devoraba el presupuesto); `llm.maxTokens` predeterminado 256k→65536, retrocedido a válvula general de socorro.

### Corregidos

- **Contaminación entre sesiones** (defecto existente): los mensajes de contexto de la extracción eran un array global en memoria (el contenido de la sesión A servía de fondo a B y se perdía al reiniciar); ahora se consultan al vuelo en L0 por sesión (vía el índice de sesiones) excluyendo la propia rodaja; los disparadores de destilación cuentan las rodajas por sesión y extraen solo las rodajas de las sesiones con el umbral alcanzado — los cinco canales (umbral/inactividad/trasfondo/cambio de modalidad/residuos de reintento) están aislados por sesión (ADR-0003);
- **Engordamiento O(N²) de la vía de escritura FTS**: el borrado defensivo del FTS pasa a una preverificación de existencia con consulta puntual sobre la tabla principal (record_id va UNINDEXED en la tabla FTS, un DELETE por id = barrido integral de la tabla — los caminos de nueva inserción como reconstrucción/re-embedding/import pagaban por cada registro un barrido integral). Comportamiento externo idéntico punto por punto (ADR-0002; el esquema de mapeo por rowid fue rechazado por el riesgo de borrados erróneos silenciosos por mapeos rancios).

### Cambios

- La guía de herramientas pasa al filtrado por tres condiciones (`tools encendidas && perfil ∥ navegación ∥ acierto de recuerdo en este turno`): los usuarios de base vacía y los de herramientas apagadas ya no pagan este impuesto fijo de tokens en cada paso;
- pending.json recibe un campo `sessionId` en sus entradas persistidas (el formato viejo cae automáticamente en el grupo de sesión legacy),
  y persiste al mismo tiempo el estado del umbral progresivo;
- el alcance de arranque encola agrupado por rodajas de sesión;
- **la tokenización de la búsqueda china pasa de bigramas CJK a tokenización por palabras jieba** (alineada con la implementación oficial de MemoryCore):
  `@node-rs/jieba` (binario napi Rust precompilado) produce la unión ordenada y deduplicada de **tokens jieba ∪ palabras latinas ∪ bigramas CJK** — los tokens dan a BM25 los aciertos de palabra entera exacta con idf alto, los bigrammas aseguran la línea de fondo del recuerdo de subpalabras; fracaso de carga → repliegue automático a solo bigramas (modo intraproceso, sin deriva posible); sello de versión del tokenizador FTS (`fts_tokenizer`: `jieba-v1` /
  `bigram-v1`): si el sello no cuadra, drop + reconstrucción + relleno de retorno automáticos; las bases viejas sin sello cuentan como `bigram-v1` en el primer arranque, migración automática.

## [0.7.1] — 2026-08-17

Lote de correcciones de la revisión íntegra (2026-08-17): ajustes documentales + rendimiento del almacén + endurecimiento de la cadena de suministro de la instalación de ejecución.

### Rendimiento

- **`PRAGMA synchronous=NORMAL`** (grado recomendado oficial del WAL): la escritura por lotes baja de un fsync por transacción a uno por
  checkpoint, re-embedding e import aceleran; el único precio: en apagón se pierden las últimas transacciones comprometidas (solo pérdida, sin corrupción);
- **Escrituras vectoriales del reindex transaccionalizadas**: las escrituras crudas línea a línea del re-embedding L1/L0 pasan a lotes por bloques (16/32 líneas) en una sola transacción
  (fracaso del lote entero → repliegue unitario, las líneas buenas no se pierden), junto con el punto anterior acorta mucho los tiempos de re-embedding de las bases grandes.

### Seguridad

- **El runtime del embedding local pasa a `npm ci` + lockfile adjunto**: `resources/runtime-package-lock.json`
  (copiado a dist/ al construir) congela del lado del autor el árbol entero de dependencias transitivas de `@huggingface/transformers` —
  el viejo `npm install pkg@versión exacta` solo cerraba las dependencias directas, las transitivas flotaban al ritmo del semver, y las publicaciones/envenenamientos posteriores del registro derivaban según el momento de instalación. Fracaso del ci (deriva del lock etc.) → repliegue automático al install (primero la disponibilidad).

### Documentación

- El CHANGELOG recibe las entradas [0.5.3] / [0.5.4] ausentes (npm ya había publicado);
- la tabla de configuración de los README en chino/inglés recibe 5 líneas: `recall.includePersona` / `recall.includeSceneNav` /
  `embedding.maxInputChars` / `embedding.timeoutMs` / `llm.timeoutMs`;
- corregida la errata china «间族» (lo correcto era «跨族»); las viejas rutas de disposición del almacén en el documento de experiencia de desarrollo
  (`l0/ l1/` → `conversations/ records/`); el nombre del archivo persona de CONTEXT.md pasa a la forma por familia.

## [0.7.0] — 2026-08-17

Modelos de embeddings locales y conmutación en caliente (la función más grande), doble tema Light/Dark, lote de correcciones de la revisión íntegra del código (issues #1-#24).

### Añadidos

- **Modelos de embeddings locales** (#20-#24): **fuente de embeddings de tres estados** (apagada / remota / local) conmutable en ejecución,
  estado persistido en `embedding-source.json`, el efecto = techo de despliegue Y elección en ejecución;
  - **Catálogo de modelos integrado** (lista blanca, revisión cerrada + sha256 por archivo): BGE small chino
    (512 dimensiones / ~25 MB), EmbeddingGemma 300M (768 dimensiones / ~330 MB, el mismo modelo que el upstream MemoryCore),
    BGE-M3 (1024 dimensiones / ~590 MB, contexto 8192); espejo por defecto `hf-mirror.com` configurable
    (`embedding.mirror`), reanudación `.part` tras corte + verificación sha256 en flujo tras la descarga;
  - **Runtime de inferencia a demanda** (transformers.js 4.2.0): se instala vía npm en el directorio de datos `runtime/` solo al pasar por primera vez a local
    (anclado por su propio package.json, fuera del árbol de dependencias del plugin); los modelos se depositan en `models/<id>/`,
    borrables desde la página de ajustes (el modelo en uso está protegido);
  - **Cadena de conmutación en caliente**: calentamiento y carga → cambio de servicio + swapProvider (cambio de dimensión = DROP de la tabla vectorial) →
    sincronización inmediata del meta → re-embedding íntegro en segundo plano (progreso por contadores L1/L0, cancelable) → el estado se persiste solo tras el éxito;
    al fracaso queda la fuente vieja (el reinicio arranca en la fuente de origen); la cancelación/fallos parciales del re-embedding los repara el backfill periódico de 30 minutos;
  - Nuevas configuraciones: `embedding.allowLocalModels` (el despliegue prohíbe la modalidad local), `embedding.mirror`;
- **Adaptación de doble tema Light/Dark de la página de ajustes y de la barra de entrada** (#15-#19): dos pisos de fichas (a través de la cadena de alias dsh del host +
  sobreescritura del conjunto entero de fichas semánticas propias), el cambio de tema cambia los valores de las variables CSS en el sitio, sin re-render de React;
- **Rehacer de la UI del selector de modalidad**: modalidades traducidas (日常 / 工作 / 智能 / 关闭), panel flotante rehecho,
  llenado del deslizador (claro a la izquierda, oscuro a la derecha, siempre visible mientras se arrastra), burbuja de arrastre (doble punta de triángulo invertido), **capa de partículas**
  (campo de partículas de puntitos, densidad del campo por modalidad: 日常 disperso / 工作 olas de agua / 智能 a campo lleno, en tema claro con mezcla multiply);
  el sistema de diseño se deposita en el directorio `design/` (cuatro especificaciones: global / pill / slider / settings).

### Corregidos (revisión íntegra #1-#14 + segunda revisión independiente F1-F4 + costuras de montaje)

- store: el fallo de escritura FTS revierte la transacción entera (fin a los agujeros de índice silenciosos, #2); el relleno de embeddings pasa a incremental +
  vectores nulos marcados skipped (arregla el ciclo infinito de re-embedding íntegro cada 30 minutos, #3); fracaso del lote → repliegue unitario +
  invalidación de la caché de instrucciones al DROP + tope del set de skip (F2-F4);
- ciclo de vida: orden de parada — primero parar las tareas/lavar la cadena L0, después cerrar la base (#5); liberación de referencias en tres sitios: búfer de captura/instantánea de reconstrucción/pending
  (#4);
- recall: la query toma solo los últimos 8 mensajes + tope de 2000 caracteres, query vacía vacía la caché (#6);
- settings: reutilización del scope intraproceso al reiniciar la fibra, los interruptores ya no se ignoran en silencio (#8); caché del scope vitalicia por instancia de servicio,
  re-colgado automático al reiniciar el servicio (F1);
- rpc: re-colgado automático de los registros RPC tras la marcha o sustitución del servicio connection (#9);
- client: estados de error de los tres paneles + distintivo de degradación del resumen (#7); números de serie de las peticiones de lista que descartan las respuestas sobrepasadas (#10);
- tools: las tres herramientas en modalidad apagada responden uniformemente con el aviso; la paginación de las búsquedas con marca de corte expresa (#11);
- log: lectura a bloques hacia atrás de log-tail + repliegue de corte ante la rotación reiteradamente fracasada (#12);
- config: límites numéricos + corte de la persistencia del pending + puesta a cero del interruptor de extensión (#13);
- **costura de montaje de stats**: el handler `/rpc` no transmitía `embedManager` en sus deps — la UI de gestión de embeddings mostraba eternamente
  «almacén degradado» (la ausencia del campo opcional no era atrapable ni por TS ni por el smoke; arreglado).

### Rendimiento

- Reutilización de las instrucciones precompiladas del camino caliente de búsqueda + corte de los IN + transacciones por lotes L1 (#14).

### Documentación

- Gran retrazo del README: nueva sección «búsqueda semántica (fuente de embeddings)» (tabla de tres estados / tabla del catálogo de modelos / descarga y conmutación en caliente);
  Hero / memoria estratificada / modalidades de sesión pasan a las imágenes generadas image2; nueva vista previa de la interfaz (capturas reales de ambos temas, claro y oscuro);
  storage.svg recibe los tres estados de la fuente de embeddings y las nuevas formas de archivo; la tabla de configuración recibe dos líneas;
- el contexto de desarrollo recibe un glosario «embeddings y búsqueda»; archivado el informe de la revisión íntegra del código del 2026-08-17.

## [0.6.1] — 2026-08-17

- El predeterminado de `llm.maxTokens` 20000 → **256000**: con v4-flash a nivel de razonamiento high por defecto podía comerse cualquier presupuesto de salida dejando el cuerpo en 0 caracteres; presupuesto concedido a lo grande, y con él el razonamiento por defecto apagado.

## [0.6.0] — 2026-08-17

Niveles de razonamiento de la destilación + rehacer de la UI del selector de memoria + refuerzos de fiabilidad.

### Añadidos

- **Niveles de razonamiento de la destilación**: configuración `llm.reasoningEffort` (`off`/`high`/`max`/cadena vacía, predeterminado `off`)
  + conmutación en ejecución en la pestaña Resumen de la página de ajustes (elegir «sigue la configuración» recayendo en el predeterminado del despliegue, persistido vía servicio settings);
  el razonamiento por defecto de los modelos de reasoning podía comerse el presupuesto de salida dejando el cuerpo en 0 caracteres, por eso para la destilación el razonamiento va apagado por defecto;
- **Persistencia del búfer sin destilar**: los mensajes fracasados pendientes de reintento y los en acumulación antes del umbral se amontonan por modalidad en cubos de `pending.json`
  (escritos atómicamente tras cada intento de destilación), nada se pierde al reiniciar, alcance automático 20 segundos tras el arranque;
- **Reconstrucción íntegra de la memoria** (página de ajustes → Memoria → Resumen → Reconstruir memoria): todos los estratos derivados se reimportan tomando L0 como fuente de verdad,
  los productos viejos se archivan de un bloque en vez de borrarse, división en bloques de baja prioridad (cede el paso a la conversación normal), con pop-up de confirmación/progreso/cancelación;
  re-destilación unificada en modalidad inteligente (auto), división por sesiones (sesiones ordenadas por la hora del primer mensaje), durante la reconstrucción las nuevas conversaciones van por turnos normales.

### Cambios

- Rehacer de la UI del selector de memoria: flujo conic azul frío en los bordes de la modalidad auto, plano flotante de cristal estilo Apple (estructura de tres pisos, arreglo del
  fracaso de muestreo del backdrop-filter en Chromium), deslizador que sigue la mano 1:1 + imán por proyección de la inercia al soltar;
  colores de líneas/paradas/rótulos tematizados.

## [0.5.4] — 2026-08-16

Industrialización de la publicación: arranca npm Trusted Publishing (OIDC de GitHub Actions) — el push de un tag `v*` publica automáticamente,
sin token / sin 2FA; la comprobación de coherencia entre tag y versión del package.json actúa solo al dispararse por tag (una prueba manual vía `workflow_dispatch`
puede recorrer la cadena de autenticación de la publicación, para verificar el OIDC). Ningún cambio visible para el usuario.

## [0.5.3] — 2026-08-16

### Corregidos

- El contador del umbral se persiste justo después de la extracción L1 (una salida a mitad de proceso no retrocede, al reiniciar no se duplica la extracción);
- el presupuesto de salida de la destilación pasa uniformemente por `llm.maxTokens` (predeterminado 20000, para que el reasoning de los modelos de razonamiento no devore el presupuesto dejando el cuerpo en 0 caracteres).

### Añadidos

- La inyección de perfil/navegación de escenas de la modalidad auto se estructura: agrupación por categorías + etiquetas de dominio `<domain family>`, en lugar de la concatenación brutal de las dos familias.

### Documentación

- La manera de instalar en el README pone npm en primer lugar (GitHub / ruta local como alternativas), `files` incluye el recurso hero.

## [0.5.2] — 2026-08-16

Arreglo del grave bug en Linux/macOS por el que «cualquier llamada de herramienta reportaba
`Cannot read properties of undefined (reading 'prepare')`»
 (incidente real bajo WSL: la llamada a la herramienta bash caía en el acto, fracaso a nivel de turno).

### Causa raíz

El plugin había declarado los paquetes de runtime del host (`@deepseek-ai/cordis`, `dsh-tools` etc.) como simples
`dependencies` — el instalador instalaba para el plugin **copias privadas**, formando con el grafo de módulos del host un **doble
`dsh-tools` en dos instancias**. El servicio `ToolRuntime` se instanciaba desde la copia del plugin, mientras
`dsh-agent-loop` leía el planificador con el `Symbol(@deepseek-ai/dsh-tools.scheduler)` de la copia del host — las identidades de Symbol no coincidían (mismo nombre, instancias distintas), la lectura se iba al vacío → cada llamada de herramienta
lanzaba un TypeError en `scheduler.prepare`. Bajo Windows ambos grafos por suerte se resolvían en el mismo orden y funcionaba; en Linux (hoisting de pnpm + disposición symlink) ocurría sistemáticamente.

### Corregidos

- **Los paquetes de runtime del host pasan a `peerDependencies`** (alineados con la convención de los plugins oficiales, como
  `dsh-bash-local`: cordis / dsh-agent / dsh-home-paths / dsh-llm /
  dsh-session / dsh-settings / dsh-system-prompt / dsh-tools, intervalo `^`),
  la instalación ya no produce copias privadas, plugin y host comparten el mismo grafo de módulos;
- las versiones necesarias para el desarrollo local migran a `devDependencies` (construcción/smoke sin tocar);
- las dependencias de pura biblioteca se quedan en `dependencies` (schemastery, sqlite-vec).

## [0.5.1] — 2026-08-16

Arreglo del bug de registro del lado cliente introducido por el cambio de nombre del 0.5.0 (incidente real: tras instalar desde GitHub, el lado navegador reportaba
`client-modules: bundle ... loaded without registering "dsh-prime-memory"`, y todos los controles de memoria de la página de ajustes y de la barra de entrada quedaban inservibles).

### Corregidos

- **El id de registro del bundle cliente sigue al nuevo nombre del paquete**: el `window.__ModuleLoader__.load({ id: ... })` de `client/client.js` pasa del viejo nombre `dsh-memory-plugin` a
  `dsh-prime-memory` — al cambiar de nombre en 0.5.0 solo se cambiaron el lado host y la declaración del bundle, olvidando la mitad navegador,
  así que el nombre de la entrada del loader y el nombre de registro divergían y la carga del bundle caía al instante. El nombre del plugin en el lado host
  `dsh-memory-plugin`, la clave de configuración `dsh-memory` y los endpoints RPC `dsh-memory/*` quedan sin cambios
  (cambiarlos rompería las configuraciones existentes y los canales de datos).

### Documentación

- Embellecimiento visual del README (beautify-github-readme): hero nativo del proyecto (`assets/readme/hero.svg`,
  un SVG de la canalización estratificada L0→L3, la anchura decreciente muestra el afinamiento de los datos); reordenación en «valor → mecanismo → primer paso → detalles»,
  fusión de las secciones en doble, incorporación como `<p align="center"><img width="100%">`.

## [0.5.0] — 2026-08-16

Rearmo para la publicación pública: el paquete se renombra a **`dsh-prime-memory`** (el viejo nombre `dsh-memory-plugin` estaba ya ocupado en npm por
un plugin de la misma casta), y el empaquetado conforme a la especificación oficial de paquetes compuestos (bundle) queda completado.

### Cambios

- **Declaración de `dsh.bundle`** (nuevo `cordis.patch.yml` en la raíz): tras la instalación en un comando `dsh plugin --profile <name> add`,
  **la línea del plugin se monta automáticamente**, ya no hace falta retocar a mano el patch.yml del perfil;
  `files` incluye este archivo;
- **desmaquinización de las dependencias**: las `@deepseek-ai/*` pasan de las rutas absolutas `file:` (que apuntaban al perfil local) a las versiones exactas de npm
  (`0.1.0-rc.6` de un grado, cordis `4.0.1`, schemastery `3.18.1`) — en cualquier máquina resuelven `npm install` / `dsh plugin add`
  (rc.6 cuelga del dist-tag `next`, no usar intervalos `^`);
- higiene del repositorio: LICENSE MIT, `.gitignore` (ignora `node_modules/`, `dist-smoke/`, `.zcode/`),
  reescritura de la sección de instalación del README (instalación en un comando + desinstalación + consejo de seguridad + desarrollo desde el fuente), corregidos los títulos duplicados.

## [0.4.2] — 2026-08-16

Refuerzo del diagnóstico de las salidas vacías del LLM de destilación (incidente real: dos turnos seguidos de deduplicación/extracción L1 con 0 caracteres de salida, y en los logs solo una
`cita de los primeros 400 caracteres de la salida cruda:` vacía, sin el menor indicio in situ).

### Valor de la pesquisa de la causa raíz

`callLLM` antes solo anotaba los recuentos de caracteres de entrada/salida; cuando «el stream terminaba con normalidad sin haber escupido ni una palabra», no se podía distinguir
«el modelo produjo solo razonamiento (text vacío)» de «el servidor respondió vacío». Los dos casos fracasados
(35~38 s, 0 caracteres, 13.000 caracteres de entrada) estaban lejos de los presupuestos de vencimiento (120 s) y maxTokens (4096).

### Cambios

- `callLLM` recoge **estadísticas por bloques** en el flujo: motivo de fin (stop/max-tokens/tool-calls/error/aborted),
  contadores de tokens del usage (outputTokens/reasoningTokens), número y caracteres de los bloques text-delta,
  caracteres de los reasoning-delta (con cita de 300 caracteres), distribución de los tipos de block-end;
- **log de diagnóstico warn cuando la salida está vacía**, llevando toda esa estadística — en la próxima salida vacía se podrá decidir al momento si el reasoning devoró el presupuesto, el motivo de fin, o si el servidor respondió vacío;
- el log ordinario de `llamada LLM` añade el motivo de fin (a coste cero cuando la salida no está vacía).

## [0.4.1] — 2026-08-16

Arreglo del defecto de captura L0 que perdía el mensaje user en los turnos con respuestas largas (incidente real: en una conversación de 4 turnos, el turno 3 perdía el mensaje user y el turno 4 perdía user + el primer mensaje assistant).

### Causa raíz

La session.jsonl exportada es un registro **tras compresión**; en el flujo en tiempo real de `session/event`, cada respuesta en streaming trae además multitud de eventos
text-delta/reasoning chunk. Los turnos con respuestas largas (texto largo + razonamiento + búsqueda en red) superaban con el recuento de sus eventos en tiempo real el `MAX_BUFFER=500` del búfer de captura, y el recorte desde la cabeza (`splice(0, len-500)`) se llevaba el `turn/start` **más antiguo** del turno y el mensaje user — `findTurnStart` no encontraba ya el comienzo del turno, y la captura degeneraba en «todo el búfer como turno corriente», quedando solo los mensajes de cola del turno. Los turnos con respuestas cortas no alcanzaban el límite, por eso los turnos 1 y 2 quedaban completos.

### Corregidos

- **El búfer solo acepta 4 tipos de eventos** (user/message, assistant/message, turn/start, turn/end),
  los chunks en streaming se descartan a la entrada (`isCaptureRelevant`) — el volumen del búfer baja de cientos/turno a unidades/turno;
- **ley férrea del recorte**: los eventos de un turno en marcha (tras un turn/start sin cerrar) nunca se recortan, solo se corta el prefijo completado que lo precede
  (`trimBuffer`, defensivo, prácticamente inalcanzable);
- **escritura L0 inmediata**: en el turn/end, escritura enseguida vía una cadena serial independiente (`capture.ts`), sin pasar por la cola de destilación —
  antes el L0 podía quedar bloqueado por una llamada LLM lenta (26 s medidos); si dsh salía en plena destilación, el L0 en cola se perdía; el runner ya no responde de la escritura del L0.

### Verificación

- El smoke recibe la sección 12: lista blanca de los 4 tipos de eventos, exclusión de los chunks, escenario de recorte con 600 eventos + turno en marcha
  (turn/start + user no se pierden), tope de 500 sin turnos en marcha, sin recorte por debajo del límite.

## [0.4.0] — 2026-08-16

Modalidades de memoria por sesión: control de cuatro estados (auto/chat/work/apagada) + aislamiento escritura-recuerdo en la misma modalidad + almacén L2/L3 por familias.

### Añadidos (UI)

- **Control de modalidad en la barra de entrada** (`conversation.input.left`, a la derecha del selector de modalidades): la píldora muestra la modalidad actual
  (`记忆·自动` etc., coloreada según la modalidad), un clic levanta sobre ella un **selector deslizante estilo macOS** —
  raíl horizontal + cuatro puntos de parada (apagada · chat · work · auto), la línea atraviesa el centro de la bola,
  empuñadura de arrastre (con sombra), tras soltar **adherencia al punto de parada más cercano** y envío optimista vía RPC (rollback al fracaso + señal roja);
  la modalidad actual se señala con el resalte de la etiqueta inferior (arriba sin texto); un clic en la etiqueta de una parada salta directamente a la modalidad, clic fuera/Esc cierra;
  al cambiar de sesión el componente se remonta automáticamente y tira de la modalidad de esa sesión;
- el navegador de la página de ajustes conserva la **vista mixta** de las dos familias (concatenación de los endpoints de escenas/perfil), y la «familia de prompts» del resumen pasa a ser «modalidad por defecto».

### Añadidos (semántica: escritura y recuerdo en la misma modalidad)

- **Cuatro estados de modalidad** (`MemoryMode = auto | chat | work | off`), independiente por cada sesión, persistido por sessionId en `session-modes.json`
  (> 90 días / > 500 entradas limpieza automática, escrituras serializadas):
  - `chat` / `work`: el prompt estrecho destila su familia → escritura solo en la biblioteca de su familia; el recuerdo consulta solo las memorias de la familia + perfil/navegación de escenas de la familia;
  - `auto` (**predeterminado de las sesiones nuevas**): extracción en un solo paso con prompt de vocabulario fundido (tres clases personales + cuatro de trabajo, las 7 abiertas),
    cada memoria recibe su etiqueta de familia por prefijo de tipo; el recuerdo abre ambas familias (perfil/navegación de las dos familias concatenados);
  - `off`: esta sesión es totalmente invisible para el sistema de memoria — ninguna escritura L0, ninguna destilación, ningún recuerdo, las tres herramientas del modelo responden con el aviso;
- la modalidad por defecto de las sesiones nuevas = configuración `family` (la unión se ensancha a `auto|chat|work`, predeterminado `auto`, semántica retrocedida a
  «modalidad por defecto»; las chat/work configuradas expresamente por los despliegues viejos siguen siendo válidas); el cambio a mitad de sesión vale desde el turno siguiente, las memorias ya extraídas se quedan en su familia de origen;
- se suma al interruptor global: el global es la llave de paso principal, las modalidades de sesión se diferencian debajo.

### Cambios (aislamiento del almacén por familias)

- **memory.db sigue siendo una única base**: `l1_records`/`l1_fts` reciben una columna `family` (lo existente rellenado por prefijo de tipo,
  la tabla FTS se reconstruye automáticamente); las tres estrategias de búsqueda (FTS/vector/hybrid) soportan todas el filtro por familia (vía vectorial: sobrerrecuerdo + filtrado aguas abajo);
- **L2/L3 escindidos en archivos por familias**: `scenes/chat|work/` (los viejos `scenes/*.md` migran automáticamente a chat),
  `persona-chat.md` / `persona-work.md` (el viejo `persona.md` se renombra automáticamente), `state.json` sube a la v2
  con checkpoint por familia (el viejo contenido plano cae en el cubo chat); contadores de umbral L2/L3, cadenas de contexto, variantes de prompt, todos independientes;
- los candidatos de la deduplicación se recuerdan solo dentro de la misma familia (la deduplicación jamás cruza familias); el búfer L1 a reintentar se amontona en cubos por modalidad;
- las herramientas del modelo se filtran según la modalidad de la sesión llamante (`exec.agent.id === sessionId`);
  `memory_read_scene` busca por nombre en los directorios de las dos familias, el parámetro persona pasa a ser `persona-chat.md|persona-work.md`.

### Añadidos (RPC)

- `dsh-memory/session-mode-get {sessionId} → {mode, defaultMode}` y
  `dsh-memory/session-mode-set {sessionId, mode}` (validación por lista blanca de los cuatro valores).

### Migración (todo se ejecuta automáticamente dentro de init)

1. `l1_records`: ALTER añade la columna family + relleno por prefijo de tipo; si falta la columna en `l1_fts`, drop + reconstrucción + relleno de retorno;
2. `state.json`: v1 plano → v2 por familias (los datos viejos caen en chat);
3. `scenes/*.md` → `scenes/chat/`; `persona.md` → `persona-chat.md`;
4. **sincronización del despliegue**: del `cordis.patch.yml` del perfil web, borrar la línea `family: chat` (si no, la modalidad por defecto seguiría siendo chat).

### Verificación

- El smoke recibe la sección 11: inferencia de las etiquetas de familia / persistencia del almacén de modalidades y modalidad por defecto / filtro FTS por familia + aislamiento de candidatos por familias +
  filtro de las listas por familia / migración y relleno de una base vieja real (sin columna family) + reconstrucción FTS / migración de los viejos archivos de escenas y perfil /
  state v1→v2 / prompt de vocabulario fundido que contiene las 7 clases / endpoints RPC de modalidades (incluido el rechazo de valores ilegítimos);
- `Config['~standard'].validate({})` pasa con family=auto por defecto.

## [0.3.0] — 2026-08-16

Navegador de memorias + interruptores de modalidad de memoria: la página «Memoria» de los ajustes asciende de una simple tabla de cuentas textual a un panel de contenido con múltiples pestañas.

### Añadidos (UI)

- **Navegador de memorias multi-pestaña** (Ajustes → Memoria):
  - **Resumen**: contadores de ejecución + panel de interruptores de la modalidad de memoria + refresco automático cada 5 segundos;
  - **Memoria**: lista de cartas de memorias L1 — búsqueda por palabras clave (BM25, la misma fuente que el recuerdo) + filtros por tipo/contexo +
    presentación de la relevancia + clic para desplegar el detalle (cadena de marcas de tiempo/versión/mensajes de origen); por defecto en orden decreciente de actualización, carga paginada;
  - **Escenas**: texto íntegro de los bloques de escena L2 (con META de popularidad/resumen);
  - **Perfil**: texto íntegro del persona L3;
  - **Registros**: desplazamiento de las últimas 200 líneas de memory.log.
- **Interruptores de la modalidad de memoria** (general + tres sub-interruptores captura/destilación/recuerdo, en gris cuando el general está apagado):
  van por el servicio settings oficial (namespace `dsh-memory`, efecto live, persistencia oficial),
  los interruptores de página escriben vía RPC en loopback; semántica = configuración estática (techo de despliegue) Y interruptor de ejecución.

### Añadidos (Host)

- Nuevos endpoints RPC (en el mismo canal loopback `/rpc`): `dsh-memory/settings-get` / `settings-set` /
  `list-records` (paginación de navegación + doble vía por palabras clave + facetas de escenas) / `scenes` / `persona` / `log-tail`;
- `L1Store.list()` (SQL en orden decreciente de actualización + filtros por tipo/contexo + paginación) y `distinctScenes()`;
- filtrado de ejecución en tres lugares: la entrada de eventos de captura, el paso de destilación del runner, la función de texto de inyección del recuerdo;
- si el servicio settings está listo después del plugin, colgado automático de refuerzo (escucha de `internal/service`), en su ausencia todo queda abierto con una nota.

### Verificación

- El smoke recibe: paginación/filtros de las interfaces de navegación, valores por defecto del esquema de los interruptores, distribución de los endpoints RPC de extremo a extremo
  (aserciones endpoint por endpoint sobre una fake connection, incluida la escritura de los interruptores y el rechazo de los endpoints desconocidos);
- arranque real: línea de log `interruptores de la modalidad de memoria listos (namespace settings dsh-memory)` confirmada, HTTP 200.

## [0.2.4] — 2026-08-16

Diagnosticabilidad completada: los nodos clave de toda la canalización entran en los logs; ante cualquier avería, el único archivo `memory.log` basta para reconstruir el camino de ejecución.

### Añadidos

- **Estadísticas de las llamadas LLM**: cada llamada de destilación anota `provider/model, caracteres de entrada/salida, duración`,
  el fracaso anota la causa + la duración (antes un fracaso solo dejaba el mensaje desnudo, sin contexto de ruta);
- **cita del original al fracasar el parseo JSON**: fracaso de análisis de las operaciones de extracción L1 / deduplicación L1 / escena L2 — se anotan los primeros 400 caracteres
  de la salida cruda del modelo (la información clave para investigar las derivas de las salidas del modelo);
- **estadísticas de las decisiones de deduplicación**: log de una línea `extraídas N entradas → recordados M candidatos → decisiones store/update/merge/skip=x/y/z/w`,
  sin entradas de decisión se cuenta como skip;
- **duraciones de las fases de la canalización**: inicio/fin de la canalización de destilación (con el número de novedades del turno y la duración total), escritura L0, duraciones de las fases L1/L2;
- **detalle de la captura L0**: la captura a nivel de turno sube de debug a info (incluida la distribución de las entradas user/assistant);
- **aciertos del recuerdo**: al recordar, número de entradas + cita de la query (debug → info);
- **refuerzo de la información de arranque**: la línea del directorio de datos lleva el número de versión del plugin; nueva línea de resolución de la ruta del modelo de destilación
  (un error de ruta aflora al arrancar, ya no se espera al primer fracaso de extracción);
- razones de salto de L2 (progreso del umbral), de no-disparo de L3 (progreso del umbral) al log debug;
- todos los fracasos de la canalización avisan con el primer cuadro de la pila de error (`errDetail`).

## [0.2.3] — 2026-08-16

Arreglos de diagnosticabilidad: tras dos turnos de conversación real, L0 tenía datos pero L1 no producía nada, y el host dsh sin logs persistentes no permitía localizar la causa.

### Añadidos

- **Log a archivo**: el nivel info y superior se espeja en `memory.log` del directorio de datos (rotación a `.1` por encima de 2 MB),
  el fallo de escritura se ignora en silencio — el host dsh manda los logs del plugin solo a la consola; ahora los asuntos de la canalización de destilación se investigan a posteriori.
- **Razones de salto de la captura L0 en el log**: los mensajes user frenados por la protección de arranque en frío y los mensajes de origen no usuario (`source.kind≠user`)
  obtienen cada uno una entrada info — para diagnosticar los huecos de captura del tipo «un turno que solo deja mensajes assistant».

### Corregidos

- **L1 «éxito con producción cero» y «fracaso» distinguibles**: cuando la extracción tiene éxito sin memorias extraíbles,
  `state.lastExtractAt` también avanza (antes se quedaba en 0, indistinguible de una excepción de extracción).
- **Pérdida en el hot-reload del contexto de recuerdo**: el disposer de `systemPrompt.context()` antes no estaba colgado del ciclo de vida del plugin,
  tras el hot reload quedaban los viejos registros y las nuevas instancias chocaban (`"memory:recall" is already registered`);
  ahora, al desinstalar el plugin, todos los `memory:recall` / `memory:profile` sobre los agentes se desregistran activamente.

## [0.2.2] — 2026-08-15

Lote de correcciones de la revisión de código.

### Corregidos (alta gravedad)

- **Autodegradación del constructor de MemoryDb (S1/P5)**: cualquier fracaso de apertura de la base / creación de directorio / PRAGMA ya no lanza, sino que entra en el
  modo degradado (todas las lecturas/escrituras como no-op seguros), y `init()` sobre una instancia ya degradada cortocircuita al momento — **ningún fallo de almacén puede ya derribar el arranque del host dsh** (el invariante storage-degrade vuelve a valer).

### Corregidos (semántica de búsqueda, alineada con lo oficial)

- **Nada más de filtro por umbral antes de la fusión hybrid (P6)**: el hybrid oficial funde directamente por RRF las listas completas de cada vía,
  `scoreThreshold` solo vale para las estrategias de vía única keyword/embedding (documentado);
- **puntajes de la fusión hybrid normalizados a 0~1 (P6)**: doble columna con rang 1 = 1.0, columna única ≤ 0.5, arregla la semántica rota por la que memory_search reportaba al modelo puntajes de 0.02~0.03;
- **coeficiente de sobrerrecuerdo alineado con lo oficial (P1)**: el vaso de candidatos está fijado = limit × 3 (la misma fórmula que la vía tool oficial),
  el engordamiento extra del filtro por tipo se retira (el documento que decía a torto ×5 se corrige de paso — la descripción de 0.2.0 era inexacta, el código real multiplicaba ×9).

### Corregidos (robustez)

- **Escritura aplazada de embedding_meta (P7)**: el meta se persiste solo tras un re-embedding enteramente logrado (o base vacía sin vectores históricos); al fracasar se reactiva en el siguiente arranque — arregla el hueco «meta escrito demasiado pronto, la tabla vectorial queda vacía para siempre y el bit de capacidad reporta true»;
- **relleno vectorial periódico (P3)**: con la capacidad vectorial encendida, cada 30 minutos (primera corrida un minuto tras el arranque) se compara el número de filas vectoriales y de filas de metadatos, y lo que falta se re-embeddea automáticamente — los lotes de embedding fracasados ya no piden ayuda manual;
- **migración de los datos viejos verificada de veras (P8)**: el cambio de nombre a `.imported` ocurre solo si todas las entradas entraron con éxito en base; el fracaso del rename / import parcial registra de verdad y reintenta en el siguiente arranque (upsert idempotente);
- **decisiones de deduplicación L1 en consultas exactas (S3)**: `pipeline/l1.ts` toma las entradas con `getByIds()` sobre la unión de id candidatos/objetivo,
  en vez de barrar toda la tabla con `all()` en cada turno.

### Corregidos (panel de estado)

- El número de versión de las stats se lee de `package.json` (antes estaba clavado en 0.1.0); `message` refleja el estado degradado;
  `pendingExtract` se engancha al verdadero contador a reintentar del runner (P4); la presentación del directorio de datos va uniformemente por `resolveDataDir`.

### Limpieza (juicios de la revisión)

- `EmbedHelper` concentra la lógica de degradación/aviso del embedding duplicada entre L0/L1; `EmbeddingProviderInfo` se exporta uniformemente desde
  `embedding.ts`; el título de la navegación de escenas remite uniformemente al `NAV_HEADER` de `persona.ts`;
- código muerto retirado: `Bm25Index.add`/banderita sucia/campo `snippet`, `makeSnippet`, `readTodayCount`,
  los export no consumidos del recall, el parámetro onProgress sin usar de `reindex` (el valor de retorno pasa a `{written, failed}` para juzgar el momento del meta);
- la semántica de `[DELETED]` se alinea documentalmente (delete del lado LLM → borrado del archivo del lado ingeniería; la lista tolera las marcas heredadas).

## [0.2.1] — 2026-08-15

### Añadidos (control del presupuesto de tokens de entrada)

Contexto del modelo de destilación de 1M de tokens, en el diario se usa con un presupuesto de ~700k (`llm.maxInputChars`, predeterminado 700_000 caracteres,
convertido con prudencia a 1 carácter chino ≈ 1 token):

- **Extracción L1 por bloques**: si los mensajes a extraer superan el presupuesto, corte automático en bloques y extracción encadenada en varios pasos (los nombres de contexto se enganchan de bloque en bloque, `chunkByCharBudget`),
  no se pierde ningún mensaje — cubre ambos caminos de los turnos de agente sobrelargos y del amontonamiento de los reintentos de extracción (en el peor caso ~840k caracteres);
- **corte de socorro de callLLM**: si el prompt de usuario de una llamada de destilación supera el presupuesto — corte con anotación (la última red para L2/L3 y los escenarios anómalos);
- los mensajes unitarios siguen recortándose en el lado de la captura a `capture.maxMessageChars` (4000 caracteres), y las entradas L2/L3 quedan naturalmente limitadas por el tamaño de los archivos de escena.

### Configuración

- El modelo de destilación queda fijado expresamente a `deepseek-official / deepseek-v4-flash` (`cordis.patch.yml`),
  no sigue los cambios del modelo por defecto de dsh.

## [0.2.0] — 2026-08-15

Rehacer de las capas de almacén y de búsqueda según la arquitectura del backend sqlite oficial de [MemoryCore](https://github.com/TencentDB-Agent-Memory) (TencentDB Agent Memory):
**doble escritura JSONL como fuente de verdad + SQLite como motor principal de búsqueda + búsqueda mixta de tres estrategias**.
Motivación: en la vieja implementación, cada consulta de búsqueda L0 releía casi 30 días de archivos y construía al vuelo un índice BM25 en memoria, y L1 se cargaba entero en memoria reescribiendo todo el archivo en cada deduplicación — pasado cierto volumen de datos, se derrumbaban tanto el rendimiento como la cuota de recuerdo.

### Cambios (arquitectura de almacén)

- **Nueva base de búsqueda `memory.db`** (`src/store/sqlite.ts`, módulo integrado `node:sqlite` + WAL + FTS5 +
  tabla vectorial coseno vec0 de `sqlite-vec`), la combinación de PRAGMA tomada del oficial (busy_timeout/WAL/cache_size/mmap/wal_autocheckpoint).
- **Semántica de doble escritura (como el oficial)**: los archivos JSONL en append se retroceden a fuente de verdad de backup/restauración, **solo se añaden, nunca se modifican**;
  toda la búsqueda va por SQLite — L0 ya no barre archivos para construir el índice, L1 ya no se carga de golpe ni se reescribe.
- **Disposición de los datos alineada con la oficial**: L0 `l0/*.jsonl` → `conversations/YYYY-MM-DD.jsonl`;
  L1 `l1/records.jsonl` (reescritura íntegra de un solo archivo) → `records/YYYY-MM-DD.jsonl` (añadido por días). La vieja disposición se importa automáticamente en la base de búsqueda al arrancar el plugin y se renombra a `.imported` (`l0/` → `l0.imported/`,
  `l1/records.jsonl` → `l1/records.jsonl.imported`), sin migración manual.
- **Camino de escritura deduplicación/fusión reescrito**: la aplicación de las decisiones de `pipeline/l1.ts` pasa de la reescritura íntegra `all() + replace(next)` a la semántica oficial — el resultado de la fusión se **añade como registro nuevo** (versión +1), y el objetivo sustituido se quita solo de la base de búsqueda con `deleteBatch`.
- Los campos de las entradas L1 se alinean con el oficial: nuevos `version`, `source_message_ids`, `metadata`
  (version/metadata se escriben en la base de búsqueda; source_message_ids solo vive en la fuente de verdad JSONL).

### Cambios (búsqueda)

- **Búsqueda de tres estrategias** (`recall.strategy`, predeterminado `hybrid`):
  - `keyword`: búsqueda a texto íntegro FTS5 BM25 (`bm25()` rank → puntaje 0~1, fórmula tomada del oficial);
  - `embedding`: KNN coseno vec0 de sqlite-vec (score = 1 − distancia coseno), capacidad opcional;
  - `hybrid`: ambas vías en paralelo + **fusión RRF (k=60)**, la misma receta que la búsqueda mixta oficial.
- **Parámetros de búsqueda oficiales trasplantados**: multiplicador de sobrerrecuerdo (vaso de candidatos = limit × 3), búfer de compensación de vectores nulos del KNN vec
  (+10), umbral de puntaje del recuerdo `recall.scoreThreshold` (predeterminado 0.3, con la excepción del corpus pequeño del FTS —
  si el número de resultados no pasa de maxResults, se conservan los aciertos de baja puntuación), filtro a posteriori por tipo (la vía de las herramientas no toma el umbral).
- **El recuerdo de candidatos de la deduplicación sube a los 3 grados oficiales**: base vacía → saltar; vector con prioridad → FTS como respaldo (antes: BM25 en memoria, un solo grado).
- Construcción de la consulta FTS: tokens entre comillas enlazados con OR + filtro de las palabras vacías chinas (pequeña tabla oficial); tokenización por los
  bigramas CJK + tokenizador de palabras inglesas del proyecto (el mismo tokenizador en los lados de lectura y escritura garantiza el alineamiento), **sin dependencia nativa jieba**.
- **El formato de las líneas de recuerdo** se eleva al estilo oficial: `- [type|scene] content`.

### Añadidos (embedding, capacidad opcional, apagada por defecto)

- Grupo de configuración `embedding.*`: cualquier servicio `/embeddings` compatible con OpenAI (`baseUrl/apiKey/model/dimensions`
  etc.; el `ctx.llm` de DSH no tiene endpoint de embeddings, hay que aportarlo uno mismo). Normalización L2 del cliente vectorial (como el oficial).
- `embedding_meta` persiste provider/modelo/dimensión; al cambiar la configuración, drop automático de la tabla vectorial y **re-embedding íntegro en segundo plano**
  (`reindex()`, sin bloquear el arranque).
- Embedding apagado equivale a la modalidad oficial `provider="none"` en FTS puro — **por defecto, cero dependencias externas para funcionar**.

### Cadena de degradación (degrade-don't-crash de principio a fin)

- Fracaso de la carga de sqlite-vec → modalidad de FTS puro (bit de capacidad degradado, un solo warn);
- fracaso de la creación de FTS5 → `ftsSearch=false`; fracaso de la inicialización del esquema → base de búsqueda degradada → funciones de memoria desactivadas, pero
  **el host dsh arranca igualmente** (la cadena de degradación storageOk se conserva);
- fracaso de una llamada de embedding aislada → esa búsqueda degrada a FTS + un solo aviso, el lado de la escritura salta el vector (reparable vía reindex);
- al desinstalar el plugin la conexión DB se cierra (WAL a disco), registrada en `ctx.effect`.

### Dependencias

- Nueva dependencia de ejecución `sqlite-vec@0.1.7-alpha.2` (la misma versión que MemoryCore; extensión nativa precompilada,
  la única dependencia nativa).
- `node:sqlite` es un módulo integrado de Node ≥ 22.13 (las engines ya exigen ≥ 22.16, ninguna nueva exigencia de ejecución).

### Cambios rompedores

- Disposición de los datos: `l0/` → `conversations/`, `l1/records.jsonl` → `records/` (los datos viejos se importan automáticamente,
  los archivos originales se conservan como `.imported`, se pueden limpiar a mano).
- `L1Store.search` / `searchCandidates` pasan de sincronas a **async** (la vía vectorial exige la llamada remota),
  el tercer parámetro pasa de `type?: string` a un objeto de opciones `{ type?, scoreThreshold? }` (solo API interna del plugin;
  el comportamiento externo de herramientas/recuerdos no cambia).

### Verificación

- El smoke recibe/reescribe aserciones de almacén y de búsqueda: doble escritura SQLite, búsqueda FTS chino/inglés, filtro por tipo, umbral y excepción del corpus pequeño,
  semántica de append/borrado de la fusión, **vec0 + hybrid + reindex** (falsos embeddings deterministas), migración de la vieja disposición,
  las funciones puras RRF/bm25RankToScore/buildFtsQuery — todo superado.
- Validación del llenado de los predeterminados del Standard Schema de Config (`embedding`/`recall.strategy`/`scoreThreshold`) superada.
- Verificación al arrancar de verdad: `dsh --profile web` se levanta con normalidad, `~/.dsh/memory/` engendra `memory.db` (con WAL) +
  `conversations/` + `records/`, esquema de tablas completo (l0_conversations/l1_records/l0_fts/l1_fts/embedding_meta),
  paro limpio.

## [0.1.0] — 2026-08-14

Primera versión utilizable.

- Canalización de destilación estratificada L0~L3 (captura → extracción/deduplicación L1 → consolidación de escenas L2 → destilación de perfil L3), prompts trasplantados de
  MemoryCore (doble familia chat/work).
- Recuerdo automático agent/pre-step + inyección de contexto en scope de agente (`<relevant-memories>` / `<user-persona>` /
  `<scene-navigation>` / guía de herramientas), el lado de la captura despluma las etiquetas de inyección contra los ciclos de retroalimentación.
- Herramientas del modelo: memory_search / conversation_search / memory_read_scene.
- Panel de estado de la página de ajustes (bundle cliente, canal de datos Connection RPC).
- Arreglo de bugs fatales: el nombre de export del esquema de configuración pasa de `schema` a `Config` (cordis solo lee `plugin.Config`,
  un nombre de export equivocado hace fracasar el arranque de todo el perfil); la recolección del texto en streaming del LLM pasa al block-end como autoridad (arregla la salida doble).
