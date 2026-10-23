<div align="center">

<img src="./assets/img/Hero.png" width="100%"
alt="Banner hero de DeepSeek Harness: las conversaciones se destilan automáticamente en memorias estratificadas y se recuperan antes de cada paso del modelo — a la derecha, las burbujas de chat se disuelven capa a capa en tres bandas de luz progresivamente más brillantes que alimentan una cápsula de cristal con esfera resplandeciente y órbita degradada (escala 日常·工作·智能·关闭, cuatro niveles); los hilos de luz que regresan insinúan la inyección del recuerdo">

# dsh-prime-memory

**Plugin de memoria por destilación estratificada para DeepSeek Harness: la conversación se procesa en segundo plano — captura L0 → memorias atómicas L1 → consolidación de escenas L2 → destilación de perfil L3 — y antes de cada paso del modelo las memorias relevantes se inyectan automáticamente en el contexto.**

[English](README.en.md) · [中文](README.md) · [Última versión](https://github.com/drscrewdriver/dsh-prime-memory/releases/latest) · [Informar de un problema](https://github.com/drscrewdriver/dsh-prime-memory/issues)

[![npm version](https://img.shields.io/npm/v/dsh-prime-memory?color=6f83ff\&style=flat-square\&label=npm)](https://www.npmjs.com/package/dsh-prime-memory)
[![DSH 0.2.0-rc.1](https://img.shields.io/badge/DSH-0.2.0--rc.1-8b5cf6?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![MIT License](https://img.shields.io/badge/license-MIT-536990?style=flat-square)](LICENSE)

</div>

<details open>
<summary>🌐 Idioma / Language</summary>

- [中文 README](./README.md)
- [English README](./README.en.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [README en español](./README.es.md)
- [README en français](./README.fr.md)
- [README auf Deutsch](./README.de.md)
- [README in italiano](./README.it.md)
- [README на русском](./README.ru.md)
- [安装指南（中文）](./INSTALL.md)
- [Installation guide (English)](./INSTALL.en.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [Guía de instalación (Español)](./INSTALL.es.md)
- [Guide d'installation (français)](./INSTALL.fr.md)
- [Installationsanleitung (Deutsch)](./INSTALL.de.md)
- [Guida all'installazione (Italiano)](./INSTALL.it.md)
- [Руководство по установке (Русский)](./INSTALL.ru.md)
- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog en español](./CHANGELOG.es.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog на русском](./CHANGELOG.ru.md)

</details>

## Matriz de compatibilidad de versiones de DSH

| Versión de DSH | API de registro de ajustes | Estado |
|---|---|---|
| 0.1.1-rc.2 | `settings.register()` (scope live) | ✅ Verificado |
| 0.1.2-rc.1 | `settings.register()` (hay reserva) | ⚠️ Deducido de la documentación del framework, sin pruebas reales |
| 0.1.3-rc.1 | `settings.register()` (hay reserva) | ⚠️ Sin pruebas reales (desde 0.1.3 los namespaces son cadenas simples; el plugin es compatible) |
| 0.1.5-rc.2 | `settings.register()` (hay reserva) | ⚠️ Sin pruebas reales; la semántica de la superficie Session V3 y de las ranuras de barra de entrada/ajustes pendiente de regresión |
| 0.2.0-rc.1 | `settings.register()` (scope live) | ✅ Línea de adaptación en curso (recableado del evento agent/session-start → agent/created) |

> Mecanismo de compatibilidad: el registro de ajustes pasa en tiempo de ejecución por tres ramas
> (`register` → puente `installSection` → degradación a siempre activado),
> ver la entrada 0.11.0 del [CHANGELOG.md](./CHANGELOG.md). `dsh.plugin.json` declara
> `engines.dsh` 为逐 rc 精确枚举串（0.1.0-rc.2 → 0.2.1-rc.3，18 rc）.

## Inicio rápido

Requiere Node ≥ 22.16. Dos estilos de invocación a elegir (el prefijo `npx` puede sustituir a `dsh` en cualquiera de los comandos siguientes):

```bash
# Modo 1: ejecutar la CLI oficial directamente con npx (no requiere dsh preinstalado; se puede fijar la versión, p. ej. dsh-prime-memory@0.8.4)
npx -y @deepseek-ai/dsh plugin --profile web add dsh-prime-memory

# Modo 2: con la CLI dsh ya instalada (dsh es un reenviador de pnpm; si no tienes pnpm, antes npm i -g pnpm)
dsh plugin --profile web add dsh-prime-memory

# Fuentes alternativas del paquete: repositorio de GitHub / ruta local (desarrollo y depuración; link: apunta al repositorio, basta npm run build + reiniciar dsh)
dsh plugin --profile web add https://github.com/drscrewdriver/dsh-prime-memory
dsh plugin --profile web add /path/to/dsh-prime-memory
```

### Dejar que el agente instale (recomendado)

Si el agente actual puede ejecutar comandos de terminal, envíale íntegro el siguiente mensaje:

```text
Instala el plugin dsh-prime-memory para el perfil web de DeepSeek Harness.

Ejecuta solo los dos comandos siguientes y no modifiques otros perfiles:
dsh plugin --profile web add dsh-prime-memory
dsh --profile web --dump-config

Cuando aparezca dsh-prime-memory en la salida, infórmame del resultado de la instalación.
No cierres ni reinicies por tu cuenta el DSH en ejecución; cuando termine la instalación, recuérdame que reinicie manualmente el DSH Web Host.
```

El agente debe devolver el resultado de la instalación y decirte explícitamente si
`dsh-prime-memory` ha aparecido en la configuración.

Este paquete declara una capa de composición `dsh.bundle` (`cordis.patch.yml`); tras la instalación
**la línea del plugin se monta automáticamente** — no hace falta retocar a mano
`$DSH_HOME/profiles/web/cordis.patch.yml`. Después reinicia DeepSeek Harness y verifica: la aparición
de los directorios `conversations/ records/ scenes/` y de `memory.db` bajo
`~/.dsh/memory/` acredita que el plugin se aplicó con éxito; la página «Memoria» en los ajustes
y la píldora de modo en la barra de entrada acreditan que la mitad cliente está lista.

**Desinstalación**: `dsh plugin --profile web remove dsh-prime-memory` + reinicio. Los datos permanecen en
`~/.dsh/memory/`; si ya no los necesitas, borra todo el directorio a mano.

### Desarrollo desde el código fuente

```bash
git clone https://github.com/drscrewdriver/dsh-prime-memory
cd dsh-prime-memory
npm install && npm run build
dsh plugin --profile web add .        # instalación link: ; tras cambiar código basta npm run build + reiniciar dsh
npm run smoke                         # smoke test (recompilar antes: ver comando abajo)
npx tsc src/smoke.ts --outDir dist-smoke --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --esModuleInterop
```

## Flujo de datos en tiempo de ejecución

<p align="center">
  <img src="./assets/readme/flow.svg" width="100%"
       alt="Flujo de datos en tiempo de ejecución de dsh-prime-memory: a la izquierda los eventos de conversación de User y Assistant afluyen al plugin (captura L0, destilación L1–L3, recuerdo, herramientas de memoria), el plugin inyecta memorias relevantes en el núcleo DSH de la derecha vía agent/pre-step; la destilación reutiliza el ctx.llm del núcleo, los datos se escriben por duplicado en ~/.dsh/memory/">
</p>

El plugin se cuelga de los eventos nativos de dsh (`session/event` para la captura, `agent/pre-step` para la inyección); las llamadas de destilación reutilizan el `ctx.llm` del host. El recuerdo se presenta como **inyección por el lado de los mensajes**: las memorias relevantes llegan como un mensaje sintético colocado antes del nuevo mensaje del usuario, mostrado en el flujo como una línea \*\*«Inyección de contexto · memory»\*\* (al abrirla se ve el contenido acertado) — el usuario comprueba con sus propios ojos que «la memoria funciona». La inyección está sujeta a un presupuesto de longitud y a uno de tiempo; si se superan, recorte u omisión, jamás a costa de frenar la conversación. **Deduplicación dentro de la sesión**: una memoria ya inyectada no se inyecta otra vez (ya está en el contexto del modelo: ahorra tokens cuando el usuario vuelve sobre el mismo tema); cuando el contexto se comprime con `/compact` o se vacía, el registro se reinicia y la memoria puede inyectarse de nuevo; una memoria actualizada (id nuevo si cambia el contenido) deja de estar presa del antiguo bloqueo. **Ponderación de frescura**: el orden del recuerdo pondera suavemente con `relevancia × max(0.5, 0.5^(días desde la última actualización/30))` — entre candidatos de relevancia parecida pasan primero las memorias frescas (los puestos rotan de forma natural), mientras que una memoria antigua pero suficientemente relevante se recuerda como siempre (el suelo garantiza perder como mucho la mitad del puntaje de ordenación: los hechos de largo plazo no se hunden); `recall.decayHalfLifeDays` es ajustable, 0 = desactivado.

**Panel de costes**: el coste en tokens de cada llamada LLM de destilación (extracción/deduplicación/L2/L3) se registra por `provider/model` en una tabla de detalle SQLite (retención configurable, 365 días por defecto, limpieza rodante al escribir; si la contabilidad falla solo avisa y jamás bloquea la destilación); página de ajustes → Memoria → pestaña **Costes** para visualizar: líneas de tendencia coloreadas por modelo (granularidad día/semana/mes + ventana de los últimos N días + filtro por nivel L1/L2/L3), tabla nivel × ventana temporal (llamadas / tokens de salida y de razonamiento / media / mediana), acumulados por modelo — el coste de la destilación de un vistazo. Las entradas se cuentan en caracteres (el usage en streaming de dsh no incluye los tokens de entrada); la salida y el razonamiento se cuentan en tokens.

**Herramientas de memoria (3):**

- memory\_search

- conversation\_search

- memory\_read\_scene

Grabación real en máquina — el aspecto de la inyección del recuerdo y de las llamadas de herramienta en la conversación: la línea «Inyección de contexto · memory» trae primero las memorias relevantes, después el modelo lee si hace falta el bloque de escena con `memory_read_scene` y responde directamente de memoria:

<p align="center">
  <img src="./assets/img/MemoryTools.png" width="60%"
       alt="Grabación real de la interfaz de chat (tema claro): sobre el mensaje del usuario «¿Qué tenemos que hacer últimamente?» se ve la línea «Inyección de contexto · memory»; antes de responder, el asistente enumera 4 llamadas a la herramienta memory_read_scene (parámetros: nombres de archivo .md de los bloques de escena) y después repasa de memoria los objetivos recientes y la hoja de ruta">
</p>

En una sesión restringida donde solo está abierta la vía de ejecución de código, el modelo llama indirectamente a las herramientas de memoria mediante `run_code` (anidamiento SUBTOOL en la vista de trayectorias):

<p align="center">
  <img src="./assets/img/ToolTrajectory.png" width="80%"
       alt="Vista de trayectorias de llamadas de herramienta: cronología coloreada arriba y lista de pasos a la izquierda (etiquetas coloreadas SYSTEM/CONTEXT/USER/ASSISTANT/TOOL/SUBTOOL), dentro del paso de la herramienta run_code van anidadas 5 llamadas a la sub-herramienta memory_read_scene (marca SUBTOOL), a la derecha el panel de detalle del paso seleccionado">
</p>

## Memoria estratificada (L0–L3)

<p align="center">
  <img src="./assets/img/Layers.png" width="100%"
       alt="Las cuatro capas de la memoria estratificada (refinamiento capa a capa, de arriba a la izquierda hacia abajo a la derecha): L0 conversación bruta (burbujas de diálogo) → L1 memorias atómicas (partículas de hechos resplandecientes) → L2 bloques de escena (tablones documentales de cristal) → L3 perfil central (núcleo cristalino resplandeciente); las capas quedan unidas por haces LLM de extracción/consolidación/destilación, cuyo ancho decreciente traduce el refinamiento progresivo de los datos">
</p>

## Modos de memoria por sesión

<p align="center">
  <img src="./assets/img/Modes.png" width="100%"
       alt="Modos de memoria por sesión: un raíl de cápsula de cristal con cuatro paradas (日常·工作·智能·关闭 / Diario·Trabajo·Inteligente·Apagado), la esfera resplandeciente detenida en Inteligente (por defecto); sobre cada modo una micro-escena — Diario: burbuja de chat personal, Trabajo: panel de documento de código, Inteligente: dos flujos confluyendo con la luz en su punto más vivo, Apagado: burbuja fantasma de trazos discontinuos y apagada">
</p>

- **El control**: una píldora en la barra de entrada, a la derecha del selector de modo (`Memoria · auto`); un clic hace flotar encima el deslizador de modos, adaptado a los temas claro/oscuro;

- la mitad inferior del panel flotante es la **zona de información de la sesión**: aciertos del recuerdo (aciertos/tandas de búsqueda y acumulado), progreso de acumulación
  (rebanada x de la sesión / umbral efectivo; en modo Apagado se muestra el número de rebanadas pendientes), memorias producidas en la sesión, número de mensajes de la sesión,
  más una línea de estado anómalo (almacenamiento degradado / búsqueda vectorial no disponible) y un resumen global (entradas a la espera de destilación, última destilación);
  los datos pasan por el endpoint `dsh-memory/session-stats` (registro puramente en memoria + COUNT indexado, cero I/O de archivos),
  con sondeo adaptativo mientras está abierto (2 s si está ocupado / 5 s en reposo); al cerrar, se detiene;

- la elección de cada sesión se persiste por sessionId en `session-modes.json`: nada se pierde al reiniciar o reanudar;
  se suma al interruptor global (el global es la llave de paso principal); L2/L3 están íntegramente clasificados por familia, el contenido no se filtra.

- **Solo escritura, sin lectura (#38)**: interruptor de tres estados «Inyección» en el panel flotante (seguir el global / encendido / apagado) — en «apagado» la sesión pasa a **solo escritura**: la captura y la destilación siguen (la conversación sedimenta con normalidad como L0→L1→L2/L3), pero no se inyecta ninguna memoria en esta sesión
  (la inyección del recuerdo, las zonas estables de perfil/navegación y la guía de herramientas se detienen juntas; las herramientas de lectura como `memory_search` responden con un aviso de solo escritura). La cara de la píldora cambia a `Memoria · solo escritura` para señalar el estado; la preferencia se persiste por sesión: volver a
  «seguir el global» la borra y vuelve a seguir el interruptor de recuerdo de la página de ajustes; ideal para sesiones de depuración/evaluación/sensibles que quieran «absorber sin molestar».
  Ortogonal al modo Apagado: Apagado sigue siendo la invisibilidad total (apagada incluso la captura), la sola escritura conserva la entrada y cierra la salida.

## Vista previa de la interfaz

<p align="center">
  <img src="./assets/img/ui-dark.jpg" width="49.5%"
       alt="Resumen del navegador de memoria de la página de ajustes en tema oscuro: tarjeta de estado (versión del plugin, estado de los interruptores de captura/destilación/recuerdo, capacidades FTS y vectoriales, contador de memorias L1, modelo de destilación) y baldosas estadísticas, controles de tacto acristalado y acento azul frío">
  <img src="./assets/img/ui-light.jpg" width="49.5%"
       alt="El mismo navegador de memoria de la página de ajustes en tema claro: misma disposición y misma información, fondo de tarjetas claro y la misma gama de acentos, cambio de tema sin recargar">
</p>

## Comparación medida (DSH-MemBench: referencia automatizada)

«Cómo se ven» las respuestas lo muestran las imágenes; esta sección responde con las cifras medidas de una **referencia automatizada** a la pregunta «**para qué sirve en concreto una vez activado**» ([`bench/`](./bench/), reproducible con un comando). Método: misma biblioteca de escenas, entradas idénticas palabra por palabra, **grupo A (memoria activada) ejecutado 3 veces con valores fusionados, grupo B (memoria desactivada) ejecutado 1 vez** (las tareas largas sin memoria se tragan varias veces más tokens por escena; de ahí este barrera de coste); la pista de diálogo solo corre el grupo A (las sesiones del grupo B son independientes y sin memoria: el fracaso está garantizado, ese control no aporta información y se retiró). Entorno de la pista de diálogo: `deepseek-v4-flash` oficial de DeepSeek, plugin 0.8.5 (juez y examinado de la misma procedencia, respuestas íntegras archivadas para revisión humana), Windows; el diseño de los ejercicios se inspira en [LongMemEval](https://github.com/xiaowu0162/longmemeval) / [LoCoMo](https://snap-research.github.io/locomo/) / [AMB](https://github.com/vectorize-io/agent-memory-benchmark), los tipos extendidos y la pista de ciclo de vida en [MemoryAgentBench](https://arxiv.org/abs/2507.05257) / [GoodAI LTM](https://github.com/GoodAI/goodai-ltm-benchmark) / BEAM.

> La pista de diálogo constituye la **nueva base 0.8.5** (plugin corregido + criterio de corrección rectificado); las cifras de la pista workflow siguen siendo el archivo 0.8.3 (desde 0.8.5 la biblioteca de escenas sube a 8, con una nueva escena de memoria prospectiva; queda pendiente repetir la medición).

### Pista de diálogo (20 escenas × 10 tipos de ejercicio × 3 pasadas = 420 preguntas): ¿responde con precisión?

> Base 0.8.5 (datos del grupo A; el grupo B de la pista de diálogo se retiró, solo corre A).

<p align="center">
  <img src="./assets/readme/bench-dialog.svg" width="100%"
       alt="Gráfico de precisión de la pista de diálogo de DSH-MemBench (grupo A · memoria activada): precisión global 95,2 % (400/420); los seis tipos centrales de 60 preguntas cada uno — extracción 58/60, multialto 60/60, cronología 56/60, actualización 55/60, recuerdo de escena 52/60, negativa a responder 60/60 y 0 invenciones; los cuatro tipos extendidos de 15 preguntas cada uno — acumulación incremental 15/15, actualizaciones en cadena 15/15, ordenación de eventos 14/15, reformulación sinonímica 15/15">
</p>

**Doble vía de recuerdo** (grupo A): tasa de recuerdo de la inyección pasiva del **78,1 %** (los puntos clave de la pregunta aparecían en la inyección, 281/360); en el resto, el modelo **consultó por su cuenta las herramientas de memoria** — 106 preguntas con consulta activa, **75 preguntas salvadas por las herramientas**; el 95,2 % de extremo a extremo es el resultado de la síntesis de ambas vías y de su aprovechamiento por el modelo. Mientras la base de memorias se acumulaba de escena en escena, las inyecciones de recuerdo de las sondas mezclaron 295 veces memorias de otras escenas (contadas honestamente) y aun así la precisión global subió del 92,8 % en el primer tramo al 97,7 % en el último — la resistencia a las interferencias aguantó frente a una base hinchada (sin conexión, añadiendo otros 600 registros de ruido sintético, el recall\@5 de la capa de búsqueda solo baja 2,8 pp).

**Los puntos débiles vistos por capas**: indicadores sin conexión de la capa de búsqueda (recall\@5, reproducción controlada) 73,3 % en total, de los cuales ordenación de eventos 0 % y recuerdo de escena 50 % — el 93 %+ de extremo a extremo se apoya en la robustez del modelo una vez inyectadas las memorias vecinas; **triángulo de eficiencia** (el coste de la memoria): la inyección no añade latencia (las rondas inyectadas responden de media 210 ms más rápido que las no inyectadas), la inyección ocupa ~10,3 % de la entrada por ronda, y toda la cadena de destilación se amortiza en ≈2727 tokens de entrada / 240 de salida por mensaje capturado (1172 llamadas, 0 fallos).

### Pista workflow (archivo 0.8.3 · versión de 7 escenas · grupo A 3 veces / grupo B 1 vez, sandbox de herramientas real): ¿hace bien, hace sobrio?

<p align="center">
  <img src="./assets/readme/bench-workflow.svg" width="100%"
       alt="Gráfico comparativo A/B de la pista workflow de DSH-MemBench: completitud del segmento sonda grupo A 59/69 (85,5 %) frente a grupo B 10/23 (43,5 %); comparación de costes (grupo B como barra de referencia llena, media por escena) — pasos 24,3 frente a 41,4 (B +70 %), llamadas de herramienta 37,7 frente a 62,1 (B +65 %), tokens de entrada 266k frente a 1,81M (B ×6,8); sonda de la escena de convenciones de estilo A 12/12 frente a B 0/4; tokens de entrada por escena de las tareas largas A 266k frente a B 1,81M">
</p>

**Completitud del segmento sonda: 85,5 % frente a 43,5 % (+42 pp)**: en los segmentos de enseñanza/cambio ambos grupos tienen el contexto a mano; el segmento sonda (continuar la tarea en una sesión nueva) es la única ventana de memoria pura — las tres nuevas escenas de prueba del grupo A (actualización del conocimiento de proceso / desambiguación de gemelos / continuidad de las convenciones de estilo) logran todas 12/12 sin fallo e idénticas en las tres rondas; el grupo B en la sonda de la escena de convenciones de estilo logra **0/4** (las convenciones de nomenclatura/estructura/separador de miles/pie de página solo viven en la memoria, la sandbox no permite adivinarlas); en la escena de actualización del proceso puede en cambio reconstruir leyendo los scripts (capacidad discriminante limitada por las affordances de la sandbox, anotado honestamente).

**Coste de las tareas largas: el grupo B consume por escena 6,8 veces los tokens de entrada del grupo A** (1,81M frente a 266k) — sin memoria el agente avanza reexplorando; en el nivel de razonamiento high llega incluso a fabricarse una obra entera para sondear un proceso que una simple convención de script habría bastado para codificar. Tokens de salida ×3 (46,2k frente a 15,4k), pasos +70 %. Ahí está exactamente el valor central de la memoria: **lo que se ahorra no es la dificultad de la tarea, son los viajes de ida y vuelta inútiles y la reexploración**.

### Metodología y reproducción

```bash
node bench/harness/run.mjs --arm A --repeats 3 --provider deepseek-official --model deepseek-v4-flash   # pista de diálogo (solo grupo A)
node bench/harness/run.mjs --track workflow --arm AB --repeats 3 ...                                  # pista workflow (grupos A/B en paralelo)
node bench/harness/run.mjs --track lifecycle --arm A ...                                              # pista de ciclo de vida (filtrado/off/rebuild/olvido)
node bench/harness/report.mjs --latest [dialog|workflow]                                               # informe consolidado
node bench/harness/retrieval-metrics.mjs <runDir> --flood 200,600                                     # indicadores de la capa de búsqueda + curva de inundación
```

- Puntuación: juicio programático `contains-all` + juicio punto por punto de un modelo juez (textos íntegros de las respuestas y razones de la puntuación archivados en `result.json` para revisión humana); en las preguntas con stale (actualización/cadena/olvido) solo se penaliza si «el valor antiguo se enuncia como situación vigente» — el mero relato de la evolución con valor final correcto no penaliza; las preguntas de negativa a respuesta permiten citar el contexto real para explicar «por qué no se sabe lo que se pregunta»; la completitud del workflow se valida programáticamente sobre los productos + contenidos clave (cuatro tipos de criterios: comprobaciones positivas/palabras prohibidas/ausencia del producto/existencia);

- Cara de indicadores: además de la tabla global de precisión (6 tipos centrales + 4 extendidos), se producen automáticamente los **indicadores sin conexión de la capa de búsqueda** (recall\@5 / precisión de inyección / fuga de información caducada), el **triángulo de eficiencia** (coste diferencial de inyección / proporción inyectada / contabilidad de destilación prorrateada por mensaje), el **análisis de posición a escala** (precisión/contaminación con la base creciendo) y una sección propia de la pista de ciclo de vida (matriz de filtrado por familia / doble aserción para off / fidelidad del rebuild / olvido);

- Progreso en directo: al arrancar la referencia se levanta automáticamente un panel de progreso local y se abre el navegador (`--no-panel` lo desactiva) — progreso por escena/fase/mensaje de ambos brazos A/B, latidos y frescura de la actividad (decidir al vuelo «colgado vs proceso muerto»), coste acumulado que crece mientras corre;

- Todos los indicadores proceden del usage reportado por el proveedor (entrada con desglose de aciertos de caché) y del plegado de los eventos de sesión; la cuota de caché en régimen estable excluye la primera petición de cada sesión (base 0.8.5: 89,1 % — la inyección de memoria no daña la caché);

- Uso en regresión: una pasada antes y después de cambiar el plugin, `compare.mjs` produce la tabla comparativa (cabecera de entorno verificada con gitSha + aviso de deriva del grupo B testigo + comparación de los indicadores de la capa de búsqueda);

- Límites (declaración honesta): una sola máquina; grupo A ×3 fusionado, grupo B ×1 (barrera de coste, más ruido); juez y examinado: de la misma procedencia en la base de diálogo 0.8.5, heterogéneos en el archivo workflow (glm-5.3 juzga a v4-flash); biblioteca de escenas construida por el autor (sesgada hacia escenas favorables a la memoria; sois libres de reproducirla); las affordances de los archivos de la sandbox pueden revelar en parte el proceso (el grupo B puede leer los scripts y reconstruirlo; los puntos de capacidad discriminante limitada están anotados honestamente); auditoría de herramientas a dos niveles (estricto: violación = fracaso / laxo: aviso), en la práctica 0 violaciones por ambas partes.

Informe completo y datos pregunta por pregunta: [`bench/baseline/`](./bench/baseline/).

## Disposición del almacenamiento

<p align="center">
  <img src="./assets/readme/storage.svg" width="100%"
       alt="Disposición del almacenamiento: arquitectura de doble escritura (JSONL como fuente de verdad de solo adición + memory.db como base de búsqueda principal); formas de archivo: conversations/records/scenes/persona/state/pending/session-modes/embedding-source/catálogo de modelos/runtime de inferencia/registros y archivos de reconstrucción; tres estrategias de búsqueda keyword/embedding/hybrid (RRF k=60); la cadena de degradación garantiza que el host nunca se bloquee">
</p>

La capacidad vectorial está desactivada por defecto (FTS puro). El `ctx.llm` de DSH no tiene endpoint de embeddings; la búsqueda semántica la proporciona una **fuente de embeddings de tres estados** (apagada / remota / local), conmutable en caliente desde la página de ajustes — ver la sección siguiente.

## Búsqueda semántica (fuente de embeddings)

La página de ajustes (Memoria → Resumen → Búsqueda semántica) permite elegir la fuente de embeddings, con efecto inmediato, sin tocar la configuración ni reiniciar:

<p align="center">
  <img src="./assets/img/EmbeddingSource.png" width="70%"
       alt="Panel de búsqueda semántica (fuente de embeddings) de la página de ajustes (tema claro): selector de tres estados (Apagado/Local/Remota, Local seleccionado) que muestra la fuente de embeddings actual y el aviso de instalación automática del runtime al pasar por primera vez a local; debajo, el catálogo de modelos locales enumera BGE small chino (en uso/listo), EmbeddingGemma 300M (316 MB por descargar) y BGE-M3 (560 MB por descargar) con dimensiones/contexto/peso/particularidades y entradas de descarga">
</p>

Tres fuentes de embeddings: **apagada** (por defecto, búsqueda por palabras clave BM25 pura), **remota** (aportas cualquier servicio `/embeddings` compatible con OpenAI; solo es seleccionable con las cuatro claves `embedding.*` completas), **local** (se elige un modelo del catálogo integrado, inferencia **CPU** ONNX cuantizada — sin clave API, los datos no salen de la máquina). El catálogo local es una lista blanca integrada en el plugin (revisión bloqueada por modelo + sha256 por archivo; no se pueden descargar repositorios arbitrarios).

- **Descarga**: descarga de un clic desde la tarjeta del modelo (espejo por defecto `hf-mirror.com`, reanudación tras corte + verificación de integridad sha256; si el directo no es alcanzable se puede pasar por proxy — por defecto detección automática de las variables de entorno `HTTPS_PROXY`/`ALL_PROXY` etc., ver `embedding.proxy`). Si un archivo falla, reintento automático con cambio de clave de caché (`?dshmem-retry=N`, para esquivar los objetos de caché corruptos que el CDN del espejo sirve a veces); si el sha256 no cuadra, se descarga desde cero; si hay error de red, la reanudación se conserva; los datos aterrizan en `models/<id>/` del directorio de datos, borrables en cualquier momento desde la página de ajustes;

- **Runtime a demanda**: el runtime de inferencia (transformers.js, unos 100~200 MB) solo se instala al pasar por primera vez al modo local, dentro del directorio de datos `runtime/` — fuera del árbol de dependencias del plugin, sin tocar su directorio de instalación); la carga del modelo y la inferencia corren en un **hilo worker separado**, sin congelar el event loop del host (mientras se calculan los embeddings, la conversación y la interacción con las páginas siguen con normalidad);

- **Conmutación en caliente**: cambiar de fuente a un clic — re-embedding completo automático en segundo plano (progreso visible, cancelable; mientras tanto la búsqueda degrada automáticamente a palabras clave, sin afectar a la conversación; si cambia la dimensión, la tabla vectorial se reconstruye a la nueva dimensión); si la conmutación falla se conserva la fuente antigua y, al reiniciar, arranca justamente la fuente antigua;

- **Regla de efecto = techo de despliegue AND elección en runtime**: `embedding.allowLocalModels=false` desactiva el modo local por completo; sin las cuatro claves `embedding.*` el modo remoto no es seleccionable (se puede cerrar en despliegues corporativos); el estado se persiste en `embedding-source.json`.

## Configuración

Los ajustes que pisan los valores por defecto se escriben en el `cordis.patch.yml` del propio perfil, como **entradas patch desnudas en el primer nivel** (`id:` directo, sin envolverlas en un `insert:` — añadir vía `insert:` una entrada con el mismo id que la capa bundle provoca un fallo de arranque `duplicate loader entry id`):

```yaml
- id: dsh-memory
  name: dsh-prime-memory
  config:                    # las claves sustituyen la línea entera (sin fusión profunda); escribe todas las claves que quieras conservar
    family: auto             # modo por defecto de las sesiones nuevas: auto | chat | work
    llm:                     # enrutamiento estático del modelo de destilación (ambos campos llenos = fijado de despliegue, prevalece sobre la
      provider: ''           # cadena de enrutamiento de la página de ajustes; vacío = seguir la ruta principal de la página o el modelo por defecto actual)
      model: ''
```

| Campo | Por defecto | Descripción |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `family`                     | `auto`                  | Modo de memoria por defecto de las sesiones nuevas: `auto` (doble familia automática) \| `chat` (personal) \| `work` (trabajo); conmutable temporalmente en sesión desde el control de la barra de entrada |
| `dataDir`                    | `$DSH_HOME/memory`      | Directorio de datos |
| `capture.enabled`            | `true`                  | Captura L0 |
| `capture.stripCodeBlocks`    | `true`                  | Quitar los bloques de código de los mensajes del asistente |
| `capture.maxMessageChars`    | `4000`                  | Número máximo de caracteres por mensaje |
| `capture.redactSecrets`      | `true`                  | Censura de cargas útiles: ya en la escritura de captura sustituye 8 clases de secretos (PEM/Bearer/JWT/Cookie/claves API de proveedores/correos/números largos/ID de alta entropía) por marcadores `[REDACTED:<KIND>]` — cubre L0, las entradas de destilación y las escrituras manuales; `false` restablece el texto plano (una vez activado, el texto original de L0 ya no es recuperable) |
| `trace.enabled`              | `true`                  | Trazado estructurado: eventos de recuerdo/destilación en JSONL diario (`<dataDir>/trace/`), consultable y conmutable en la pestaña «Registros» de la página de ajustes |
| `trace.retentionDays`        | `14`                    | Retención de los eventos de traza en días (`0` = para siempre) |
| `trace.captureContent`       | `false`                 | Solo con `true` se guarda el texto íntegro de las consultas de recuerdo (por defecto: solo longitud + sha256) |
| `extract.enabled`            | `true`                  | Extracción L1 |
| `extract.minMessages`        | `6`                     | Umbral en régimen estable: cuando en una sesión se acumulan N mensajes nuevos corre una extracción L1. En la fase de arranque el umbral efectivo sube duplicándose de 1 hasta este valor (memoria ya en la primera ronda, después acumulación automática para ahorrar llamadas) |
| `extract.idleSeconds`        | `300`                   | Red de seguridad por inactividad: tras N segundos de silencio de la sesión las rebanadas sin destilar se sacan del bache (atrapa el caso «se fue sin llegar al umbral»); `0` lo desactiva |
| `extract.backgroundMessages` | `10`                    | Número de mensajes de contexto adjuntos a la extracción (consultados al vuelo en L0 por la sesión, sin contaminación entre sesiones) |
| `extract.candidatePool`      | `5`                     | Tamaño del vaso de candidatos de deduplicación |
| `l2.enabled`                 | `true`                  | Consolidación de escenas L2 |
| `l2.minNewMemories`          | `5`                     | Umbral de memorias nuevas desde la última consolidación L2 |
| `l2.maxScenes`               | `12`                    | Límite superior de bloques de escena |
| `l2.sceneContextLimit`       | `3`                     | Límite de escenas parecidas adjuntas como texto íntegro al prompt de L2 |
| `l3.enabled`                 | `true`                  | Destilación del perfil L3 |
| `l3.interval`                | `20`                    | Intervalo de la destilación L3 (en memorias nuevas) |
| `recall.enabled`             | `true`                  | Recuerdo automático |
| `recall.maxResults`          | `5`                     | Límite de entradas L1 inyectadas antes de cada mensaje nuevo del usuario |
| `recall.maxCharsPerMemory`   | `500`                   | Límite de caracteres por memoria inyectada (si se pasa, se recorta con invitación a consultar el texto completo con la herramienta de memoria); `0` = sin límite |
| `recall.maxTotalRecallChars` | `2000`                  | Límite total de caracteres inyectados por ronda (si se pasa, se descarta la cola por relevancia); `0` = sin límite |
| `recall.timeoutMs`           | `5000`                  | Presupuesto total del recuerdo (ms): al superarse se salta la ronda de inyección sin bloquear la conversación; `0` = sin límite de tiempo |
| `recall.includePersona`      | `true`                  | Inyecta el contexto del perfil en el prompt del sistema (`<user-persona>`, zona estable) |
| `recall.includeSceneNav`     | `true`                  | Inyecta la navegación de escenas en el prompt del sistema (`<scene-navigation>`, zona estable) |
| `recall.strategy`            | `hybrid`                | Estrategia de búsqueda: `keyword` / `embedding` / `hybrid` |
| `recall.scoreThreshold`      | `0.3`                   | Umbral de puntuación del recuerdo (por debajo, no se inyecta; efectivo solo para las estrategias keyword/embedding, hybrid no filtra antes de fusionar; el camino de herramientas no filtra) |
| `recall.decayHalfLifeDays`   | `30`                    | Vida media del decaimiento de frescura del recuerdo (días, 0 = desactivado): el orden pondera suavemente con `relevancia × max(0.5, 0.5^(días desde la actualización/vida media))` — entre candidatos de relevancia parecida pasan primero las memorias frescas (los puestos rotan), una memoria antigua pierde como mucho la mitad del puntaje de ordenación (suelo de garantía: los hechos de largo plazo no se hunden) |
| `embedding.enabled`          | `false`                 | Interruptor de la búsqueda vectorial; apagado se funciona en FTS puro |
| `embedding.baseUrl`          | vacío                   | Dirección de un servicio /embeddings compatible con OpenAI (p. ej. `https://api.siliconflow.cn/v1`) |
| `embedding.apiKey`           | vacío                   | Clave API |
| `embedding.model`            | vacío                   | Nombre del modelo de embeddings |
| `embedding.dimensions`       | `0`                     | Dimensión de los vectores (obligatoria si está activada, debe coincidir con la salida del modelo) |
| `embedding.maxInputChars`    | `5000`                  | Número máximo de caracteres por texto (recorte si se supera) |
| `embedding.timeoutMs`        | `10000`                 | Tiempo máximo de una llamada de embeddings (ms) |
| `embedding.allowLocalModels` | `true`                  | Permite el modo de embeddings local (techo de despliegue: desactivado, la página de ajustes no puede descargar modelos ni pasar a local) |
| `embedding.mirror`           | `https://hf-mirror.com` | Raíz del espejo de descarga de modelos locales (se puede devolver al oficial `https://huggingface.co`) |
| `embedding.proxy`            | `''`                    | Proxy para descargar modelos, tres estados: `''` (por defecto) = detección automática de las variables de entorno de proxy (`HTTPS_PROXY`/`ALL_PROXY` etc., respetando `NO_PROXY`); `none` = desactivación, conexión directa forzada; otro valor = URL del proxy (p. ej. `http://127.0.0.1:7890`). El acceso directo al espejo es intermitente en las redes chinas (alternan timeouts directos y bytes corrompidos); en máquinas con proxy conviene dejar la detección automática por defecto |
| `llm.provider/model`         | vacío                   | Enrutamiento estático del modelo de destilación (fijado de despliegue): con provider y model **ambos llenos** la ruta de destilación queda bloqueada y prevalece sobre la cadena de enrutamiento en runtime de la página de ajustes y sobre el modelo por defecto (el despliegue puede obligar a la destilación a ir por una ruta concreta); vacío = seguir «ruta principal de la cadena de enrutamiento de la página de ajustes → modelo por defecto». En runtime el **editor de la cadena de enrutamiento de destilación** (página de ajustes → Memoria → Resumen → Parámetros de destilación) permite configurar la ruta principal y la cadena de reserva (a elegir entre los **proveedores configurados** (incluidos los añadidos en dsh → Ajustes → Modelos); la línea de la ruta principal puede quedar vacía y seguir el modelo por defecto); si no está vacía asume íntegramente el control de esta configuración estática, con efecto inmediato y sin reinicio |
| `llm.fallbacks`              | `[]`                    | Cadena de reserva de la destilación: lista de rutas de respaldo que se prueban una tras otra, en el orden de las entradas, cuando la ruta principal falla (error/corte/error de red/**salida vacía**); entrada = `{provider, model, reasoningEffort?}` (un nivel no vacío pisa el `llm.reasoningEffort` global, siempre limitado por las capacidades del modelo); las entradas idénticas a la ruta principal se saltan automáticamente; **cada ruta dispone del íntegro** **`timeoutMs`**; si todo falla entra el reintento con back-off por sesión ya existente. Array vacío (por defecto) = comportamiento de ruta única sin cambios (ver abajo [Cadena de reserva de la destilación y modelos lentos al TTFT](#cadena-de-reserva-de-la-destilación-y-modelos-lentos-al-ttft)); cuando la cadena de enrutamiento en runtime de la página de ajustes (`distillChain`) no está vacía, **asume íntegramente** la ruta principal y la cadena de reserva (cadena de una línea = explícitamente sin reserva); vacía = sigue esta configuración |
| `llm.layerRoutes`            | `{}`                    | **Enrutamiento por capas** de la destilación: cada clave de capa `l1`/`l2`/`l3` recibe una **cadena completa** (entradas como `llm.fallbacks`, **la línea de cabeza debe declarar provider+model explícitos**); si no está vacía **sustituye íntegramente** la resolución de esa capa (la ruta principal y la reserva de la capa pasan a la cadena de capa, la cadena global no participa); vacía/ausente = la capa sigue al global; `l1` gobierna a la vez los dos puntos de llamada extracción+deduplicación. En runtime se edita capa por capa en el panel por segmentos «Parámetros de destilación» de la página de ajustes (pisa esta configuración estática); el fijado de despliegue no deroga las cadenas de capa estáticas (ambas son configuración de despliegue, mismo precedente que la cadena de reserva). Ortogonal a la cadena de reserva y combinable — una cadena por capa (ADR-0005) |
| `llm.maxTokens`              | `65536`                 | Válvula de socorro del total de salida para las llamadas sin capas. Cada capa de destilación tiene su propio presupuesto (extracción 16k / deduplicación 8k / L2 32k / L3 16k; en los niveles de razonamiento high/xhigh/max automáticamente ×4, para que el reasoning no devore el presupuesto); los presupuestos por capa se ajustan en runtime (página de ajustes → Memoria → Resumen → Parámetros de destilación; vacío/0 = valores integrados por defecto) |
| `llm.reasoningEffort`        | vacío                   | Nivel de razonamiento de la destilación: cadena vacía = **auto** (se resuelve según las capacidades del modelo: nivel por defecto del modelo → `high`); un valor explícito (`off`/`none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) solo se envía si el modelo declara soportarlo — los vocabularios de effort difieren por proveedor (deepseek acepta `off`, la familia OpenAI dice `none`, a los modelos sin niveles declarados no se les envía nada), un nivel no soportado se degrada automáticamente a «no enviar» con un único aviso; en los niveles high/xhigh/max el presupuesto de salida es automáticamente ×4. En runtime el editor de la cadena de enrutamiento permite pisar el nivel **ruta por ruta** (desplegable en línea, vocabulario mostrado en directo según las capacidades declaradas de cada modelo, por defecto sigue este valor) |
| `llm.temperature`            | `0.3`                   | Temperatura de la destilación |
| `llm.maxInputChars`          | `700000`                | Presupuesto de caracteres de entrada por llamada de destilación (la entrada L1 que se pasa se extrae automáticamente por bloques); ajustable en runtime (página de ajustes → Parámetros de destilación → Presupuesto de entrada; vacío/0 = sigue este valor) |
| `llm.timeoutMs`              | `120000`                | Tiempo máximo de una llamada de destilación (ms) |
| `tokenCost.retentionDays`    | `365`                   | Retención en días del detalle de costes de destilación (tabla token\_cost), con limpieza rodante de las líneas más viejas al escribir; `0` = retención indefinida. El techo de la ventana «últimos N días» del panel de costes coincide con este valor |
| `tools`                      | `true`                  | Registrar o no las herramientas de memoria invocables por el modelo |
| `benchControl`               | `false`                 | Registra el servicio de control bench (activación de rebuild en proceso / fijación de modos de sesión / instantánea del uso de destilación, para la pista de ciclo de vida de la referencia). Apagado por defecto — superficie nula en despliegue de producción, no lo actives a la ligera |
| `scope` | `global` | **Ámbito de almacenamiento** (visibilidad): `global` (por defecto) = visible entre espacios de trabajo; `workspace` = la **familia `work`** se aísla por espacio de trabajo. Ortogonal a `family` (tipo de contenido) — los dos ejes responden a preguntas distintas, existen los cuatro cuadrantes (`chat×global` / `chat×workspace` / `work×global` / `work×workspace`). La familia `chat` sigue global por defecto: las memorias personales deben atravesar los proyectos. **Con `global` por defecto el comportamiento es idéntico letra por letra al anterior a la introducción de esta clave** — todos los datos de raíz única existentes se adscriben a `global`; la migración solo etiqueta la pertenencia, sin mover ni borrar nada ([ADR-0008](./docs/adr/0008-storage-scope-vs-family.md) / [ADR-0009](./docs/adr/0009-workspace-identity-source.md)). Si no se puede determinar el espacio de trabajo de la sesión, se recurre a `global` (sin excepción, sin bloquear) |
| `conflictFreeze.enabled`     | `false`                 | Interruptor general de la **congelación de contradicciones**. Una vez activado, el vocabulario de decisión de la deduplicación gana la acción `conflict`: cuando el LLM juzga que «ambas versiones parecen correctas y la máquina no puede decidir», **ya no hace `update` ni `merge` automáticos**, sino que **aparca** la pareja en una cola de arbitraje — la memoria nueva entra en la base con normalidad, **el contenido de ambas partes queda intacto**, y la nueva herramienta `memory_resolve_conflict` somete el arbitraje a la persona. Apagado, el prompt de deduplicación es **idéntico letra por letra** al que hay sin la función (deriva cero). Apagado por defecto: la congelación consume atención humana y no puede estar activada para todos por defecto ([ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)) |
| `conflictFreeze.maxPending`  | `100`                   | Límite de la cola de arbitraje. Alcanzado el máximo de casos sin resolver, los conflictos nuevos **dejan de aparcarse** y se cierran en el acto según el winner/loser dictado por el LLM (la pareja **igualmente queda registrada en la cola**, con `resolution` = `auto` para distinguirla de las conclusiones humanas). La semántica es «**no aceptar más**», no «borrar a escondidas los viejos» — de ahí la limitación, sin perder las solicitudes de arbitraje que nadie ha visto aún |
| `conflictFreeze.timeoutDays` | `30`                    | Degradación por vencimiento (días): las parejas aparcadas más de este número de días se cierran automáticamente **al comienzo de la siguiente ronda de destilación** (como arriba, registradas con `resolution=auto`). `0` = **sin** degradación por vencimiento (desactivación explícita, no «que todos caduquen enseguida»). Sin válvula de seguridad, «dos memorias contradictorias recordadas codo con codo» quedaría para siempre en la base |

### Cadena de reserva de la destilación y modelos lentos al TTFT

En algunos proveedores de inferencia, las modalidades gratuitas/lentas alcanzan un **retraso del primer token (TTFT) de más de 20 segundos**, mientras que ciertos pasarelas aguas arriba cortan tras unos 20 segundos de silencio de conexión — las llamadas de destilación fallan de forma fija hacia los ~20 s (`llm aborted`) y el tiempo límite de 120 s del plugin no llega a entrar en juego (escenario constatado en el [#31](https://github.com/drscrewdriver/dsh-prime-memory/issues/31)). Tres niveles de mitigación, tómalos según necesites:

1. **Cambiar de ruta** (lo más directo): página de ajustes → Memoria → Resumen → Parámetros de destilación, el editor de la cadena de enrutamiento cambia al instante la ruta principal (o coloca una ruta rápida en cabeza), o fija estáticamente `llm.provider`/`llm.model`.

2. **Cadena de reserva** (degradación automática): si la ruta principal falla, las de respaldo entran por orden, sin intervención humana:

   ```yaml
   llm:
     provider: opencode-go          # ruta principal (también puedes no fijarla: sigue la ruta principal de la página de ajustes / el modelo por defecto)
     model: ox-alpha-free
     fallbacks:                     # el orden de las entradas = prioridad de degradación; sin configuración el comportamiento de ruta única no cambia
       - provider: opencode-go
         model: deepseek-v4-flash
         reasoningEffort: low       # opcional: pisado de nivel para esta ruta (por defecto sigue el global)
       - provider: deepseek-official
         model: deepseek-v4-flash
   ```

3. **Enrutamiento por capas** (cada una por su canal): las capas de destilación piden cosas distintas al modelo (L1, muy frecuente, quiere barato, rápido y estable;
   L3, rara, tolera un primer paquete lento pero exige capacidades fuertes) — a las capas divergentes se les puede dar cadena propia: **una cadena de reserva completa por capa**,
   las capas no configuradas siguen yendo por la cadena global:

   ```yaml
   llm:
     layerRoutes:                  # enrutamiento independiente por capas (#34); la línea de cabeza debe declarar provider+model explícitos
       l1:                         # l1 gobierna a la vez extracción + deduplicación: una cadena barata, rápida y estable
         - provider: opencode-go
           model: deepseek-v4-flash
           reasoningEffort: low
         - provider: deepseek-official   # reserva dentro de la capa: un fallo de L1 solo degrada hasta aquí, no hacia la cadena global
           model: deepseek-v4-flash
       l3:                         # destilación del perfil L3: entradas raras y grandes — una cadena de capacidades fuertes
         - provider: deepseek-official
           model: deepseek-v4-flash
           reasoningEffort: high
   ```

   También editable capa por capa en runtime en el **panel por segmentos** (Global / L1 / L2 / L3)
   de la página de ajustes → Memoria → Resumen → Parámetros de destilación; prioridad dentro de la capa:
   cadena de capa en runtime > cadena de capa estática de este YAML > cadena global por defecto,
   con socorro escalón a escalón.

   Fallo = error / corte / error de red / **salida vacía** (el stream termina con normalidad pero con 0 caracteres — para la destilación está condenado ya en la fase de parseo, por eso se reclasifica como fallo de esta ruta en lugar de devolver una cadena vacía); la cancelación voluntaria del llamador no degrada; cada ruta dispone del **íntegro** `llm.timeoutMs` (un presupuesto compartido daría a una ruta de reserva lenta al primer paquete una ventana menor que su tiempo real de primer paquete — la cadena de reserva sería un adorno); el coste de tokens se contabiliza en cada intento (también los fallidos, con los tokens recibidos antes del corte del stream), y la llamada con éxito se atribuye a la ruta que realmente la sirvió. La cadena de enrutamiento también se ajusta en runtime en el editor «Cadena de enrutamiento de destilación» (página de ajustes → Memoria → Resumen → Parámetros de destilación, sin tocar la configuración ni reiniciar); este YAML es para quien despliega y quiere fijar una cadena estática.

4. **Subir el tiempo límite**: `llm.timeoutMs` solo sirve si la ruta es de verdad lenta pero la pasarela no corta; cuando la pasarela corta a los 20 s, subir el límite del plugin no sirve de nada — usa los dos primeros niveles.

## Registros y resolución de problemas

El host de dsh escribe los registros del plugin en la consola; el plugin además los espeja desde nivel info en `memory.log` del directorio de datos.
Ruta típica de registros de una ronda de conversación: `L0 捕获` → `L0 落盘` → `蒸馏管线开始` → `LLM 调用（输入/输出 字符数、耗时）` → `L1 阶段完成` → `管线结束`; la ronda siguiente empieza con `召回注入 N 条 L1`. Una salida vacía del LLM
llega con diagnóstico completo (finish reason / conteo de tokens / extracto del reasoning); un fallo de parseo del JSON registra los primeros 400 caracteres
de la salida cruda del modelo; todos los fallos avisan con el primer cuadro de la pila. La fuente de verdad JSONL se añade ronda a ronda y se fía del write-back del SO (sin
fsync línea a línea): ante un apagón o un crash extremo se pierde como mucho una pequeña cola final; la base de búsqueda se puede reimportar íntegra desde la fuente de verdad con «Reconstruir memoria».

## Diferencias con MemoryCore

- Pipeline completo integrado (sin depender de una pasarela externa); la destilación reutiliza el LLM propio de DSH;

- L2/L3 pasan de «el LLM maneja herramientas sobre archivos» a «el LLM produce JSON de operaciones / documentos íntegros, la ingeniería los ejecuta»;

- El punto de inyección del recuerdo es `agent/pre-step` (mensaje sintético por el lado de los mensajes, semántica de sustitución del pre-step oficial) + `systemPrompt.context` en scope de agente (zonas estables de perfil/navegación, eventos/servicios nativos de DSH);

- Almacenamiento/búsqueda: versión monousuario recortada del backend sqlite oficial (sin columnas de aislamiento multiinquilino, backend en nube TCVDB, tablas de auditoría;
  la tokenización coincide con la oficial mediante jieba — binario precompilado @node-rs/jieba + unión con bigramas CJK,
  los tokens alimentan los aciertos de palabra entera exacta de BM25, los bigramas conservan el recuerdo de subpalabras; si la carga falla, reserva automática a solo bigramas,
  el índice FTS se reconstruye automáticamente según la estampa de versión del tokenizador).

## Retirada de memorias, restauración y limpieza

El borrado existe en **dos grados**, dictados por su coste: **el grado reversible es el predeterminado**, el irreversible exige pedirlo explícitamente y trae consigo su propio export.

| Acción | Endpoint / herramienta | Reversible | Descripción |
| --- | --- | --- | --- |
| Retirada (borrado lógico) | `memory_delete` · `dsh-memory/records-delete` | ✅ | La fila de la tabla principal se conserva + `valid_to` se cierra + se escribe un marcador de sustitución; solo se quitan las filas FTS/vector. **Por defecto solo se retira 1 entrada**; para lotes pasa `ids` exactos, no te fíes del emparejamiento semántico |
| Recuperación | `dsh-memory/records-restore` | — | Marcador de retirada eliminado + índices reconstruidos: el registro vuelve al recuerdo |
| Limpieza física | `dsh-memory/cleanup-retired` | ❌ | **La única acción irreversible** del plugin. **Ensayo en seco por defecto** (omitir `dryRun` equivale a no borrar nada); incluso con ejecución explícita, primero se toma una instantánea de toda la base y se **verifica por hash del contenido** — si no cuadra, parón y ni un borrado |
| Lista de instantáneas | `dsh-memory/snapshots-list` | — | Enumera las instantáneas de `snapshots/` con manifiesto válido (con motivo y número de entradas) |
| Reinyección desde instantánea | `dsh-memory/snapshot-restore` | — | Reescribe los registros limpiados. **Ensayo en seco por defecto**; solo acepta nombres de directorio de instantánea, no rutas |

Las tres vías de retirada — condena en el arbitraje, sustitución por deduplicación (`update`/`merge`), borrado manual — **comparten el mismo primitivo**, así que «borrar» significa lo mismo en los tres sitios: todo es recuperable.

### De qué está hecha la «pastilla contra el arrepentimiento» de la limpieza

Antes de cualquier borrado físico hay que tomar la instantánea y verificarla (ver tabla arriba). El camino de vuelta es:

1. `dsh-memory/snapshots-list` — obtener el nombre del directorio de la instantánea (con la forma `l1-<marca temporal>-<motivo>`);
2. `dsh-memory/snapshot-restore` — primero en ensayo en seco para ver `missing` (las entradas realmente recuperables, no el total de la instantánea), luego escribir con `dryRun:false` explícito.

La entrada de restauración **solo acepta nombres de directorio, jamás rutas**: si no, este RPC valdría además «lee cualquier directorio y escribe su contenido en la base de búsqueda». La restauración en sí es un upsert idempotente, repetible sin riesgo.

> **Una semántica que hay que conocer sí o sí**: `cleanup-retired` solo limpia los registros **ya retirados**, y la instantánea se toma **antes** del borrado — por eso cada entrada recuperable desde una instantánea de limpieza lleva el marcador de retirada. Por defecto `snapshot-restore` solo reescribe las filas en la tabla principal (y reporta honestamente las `stillRetired`): **«vuelto a la tabla principal» ≠ «vuelto al recuerdo»**; para un rollback verdadero en un solo paso añade `unretire: true`, o llama después a `records-restore` sobre ese lote de ids.

## Hoja de ruta

Funciones previstas — comunica necesidades y prioridades en las [Issues](https://github.com/drscrewdriver/dsh-prime-memory/issues):

- [ ] **Conciencia de ramas git**: asociar las memorias a la rama git actual; filtrar/ponderar el recuerdo por rama (ortogonal a los modos de memoria existentes)

- [ ] **Importación de memorias de Claude Code / Codex**: migración en un clic de los activos de memoria existentes (`CLAUDE.md`, archivos de memoria de Claude Code, `AGENTS.md` de Codex etc.); una vez importadas entran en el pipeline de destilación estratificada

## Agradecimientos

El ascendente directo de este repositorio es [JunNanLYS/dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)
— el plugin de memoria por destilación estratificada del lado DSH. Gracias al autor original **JunNanLYS** por abrir el proyecto: este repositorio reescribió su capa de implementación sobre esa base
(el primer commit `0b506b8` ya es «desalojo para reescritura en sala limpia — retirada la implementación vieja y los artefactos de compilación»); documentación, imágenes y arquitectura de módulos siguen al ascendente.
Frente al ascendente, este repositorio añade 12 herramientas de memoria orientadas al agente (incluidas las escrituras de alto privilegio `memory_add` / `memory_delete` /
`memory_import`, la serie de control de la rumiación `memory_ruminate`, el grafo de memoria `memory_search_graph` /
`memory_expand_graph_node`, la retrotrazabilidad de decisiones `memory_receipts`, el arbitraje de contradicciones `memory_resolve_conflict`),
el transporte de memoria entre herramientas `skills/memport`, además de la declaración de capturas para la tienda.

Dos de estas herramientas sirven a la **trazabilidad**:

- `memory_receipts` — retrotrae «**cómo** nació esta memoria». Cada decisión de deduplicación L1 deja un recibo
  (**resumen del vaso de candidatos visto en el momento de la decisión** + conclusión); por registro se puede preguntar «de qué ronda viene, qué vaso se veía entonces»,
  por lote «qué se juzgó en aquella ronda». El recibo debe existir **antes** del evento — la instantánea de entrada no puede reconstruirse a posteriori
  ([ADR-0006](./docs/adr/0006-l1-decision-receipts.md)).
- `memory_resolve_conflict` — arbitra las parejas en conflicto aparcadas por la **congelación de contradicciones** (ver la configuración `conflictFreeze.*`).
  Conclusiones `winner` / `loser` / `both`: si una parte se declara verdadera, la otra sale de la búsqueda; `both` significa
  que son dos hechos independientes y se conservan ambos.

El núcleo de las capacidades de memoria (pipeline de destilación estratificada, diseño de los prompts, arquitectura de almacenamiento de doble escritura) toma referencia del **MemoryCore** del proyecto
[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory); gracias al proyecto original por abrir su diseño y su implementación.

## License

[MIT](LICENSE)
