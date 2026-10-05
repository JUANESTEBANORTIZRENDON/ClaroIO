"""Pure calculation functions: no UI, files, session state, or rounded inputs."""
from calendar import monthrange
import csv
from io import StringIO
from math import exp, floor, isclose, isfinite, log
import re
import unicodedata
from app.models import DecisionsInput, GameInput, QueueInput

def equal(a, b):
    return isclose(a, b, rel_tol=1e-12, abs_tol=1e-9)

def winners(values, minimize=False):
    best = min(values) if minimize else max(values)
    return [i for i, value in enumerate(values) if equal(value, best)]

def weighted(row, probabilities):
    return sum(x*p for x, p in zip(row, probabilities))

def decisions(data: DecisionsInput):
    matrix = [list(row) for row in data.matrix]
    if data.mode == 'parameters':
        matrix = [[data.base[j] * (data.response[i][j] - data.costs[i]) / 100 for j in range(3)] for i in range(3)]
    best_states = [max(row[j] for row in matrix) for j in range(3)]
    regret = [[best_states[j] - row[j] for j in range(3)] for row in matrix]
    values = {
        'maximax': [max(row) for row in matrix],
        'maximin': [min(row) for row in matrix],
        'laplace': [sum(row)/3 for row in matrix],
        'hurwicz': [data.alpha*max(row)+(1-data.alpha)*min(row) for row in matrix],
        'savage': [max(row) for row in regret],
    }
    criteria = {name: dict(values=v, winners=winners(v, name == 'savage')) for name,v in values.items()}
    expected = [weighted(row, data.probabilities) for row in matrix]
    eol = [weighted(row, data.probabilities) for row in regret]
    perfect = weighted(best_states, data.probabilities)
    evpi = max(0, perfect - max(expected))
    likelihood = [[count/sum(row) for count in row] for row in data.counts]
    signals = []
    signal_value = 0
    for s, name in enumerate(['F','D']):
        probability = sum(data.probabilities[j]*likelihood[j][s] for j in range(3))
        posterior = [data.probabilities[j]*likelihood[j][s]/probability for j in range(3)] if probability > 0 else None
        conditional = [weighted(row, posterior) for row in matrix] if posterior is not None else None
        if conditional is not None:
            signal_value += probability*max(conditional)
        signals.append(dict(name=name, probability=probability, posterior=posterior, expected=conditional,
            winners=winners(conditional) if conditional is not None else []))
    evsi = max(0, signal_value-max(expected))
    return dict(matrix=matrix, criteria=criteria, regret=regret, expected=expected, winners=winners(expected), eol=eol,
        perfect=perfect, evpi=evpi, likelihood=likelihood, signals=signals, signal_value=signal_value,
        evsi=evsi, efficiency=evsi/evpi if evpi > 1e-12 else None)

def game(data: GameInput):
    m = data.matrix
    row_min = [min(row) for row in m]
    col_max = [max(m[i][j] for i in range(2)) for j in range(2)]
    maximin, minimax = max(row_min), min(col_max)
    saddles = [[i,j] for i in range(2) for j in range(2) if equal(m[i][j], row_min[i]) and equal(m[i][j], col_max[j])]
    dominance = []
    for player in ['claro', 'tigo']:
        for i, other in [(0,1),(1,0)]:
            differences = [m[i][j]-m[other][j] if player == 'claro' else m[j][other]-m[j][i] for j in range(2)]
            if all(d >= 0 or equal(d,0) for d in differences) and any(d > 0 and not equal(d,0) for d in differences):
                dominance.append(dict(player=player, strategy=i, over=other, kind='estricta' if all(d>0 and not equal(d,0) for d in differences) else 'débil'))
    mixed = None
    if saddles:
        value = maximin
    else:
        a,b = m[0]
        c,d = m[1]
        denominator = a-b-c+d
        if denominator == 0:
            raise ValueError('Matriz degenerada: no se puede calcular una mezcla única.')
        p,q = (d-c)/denominator, (d-b)/denominator
        if not (0 <= p <= 1 and 0 <= q <= 1):
            raise ValueError('La matriz no admite una mezcla interior válida.')
        value = p*a+(1-p)*c
        mixed = dict(p=p,q=q,value=value,denominator=denominator)
    return dict(matrix=m, row_min=row_min, col_max=col_max, maximin=maximin, minimax=minimax,
        saddles=saddles, dominance=dominance, mixed=mixed, value=value, type='pure' if saddles else 'mixed')


class QueueValidationError(ValueError):
    """A domain error whose message is safe to expose through the HTTP adapter."""


def mmc(data: QueueInput):
    """Calculate M/M/c using a normalized recurrence, avoiding factorial overflow."""
    arrival = data.arrival_rate_per_hour
    service = data.average_service_minutes
    servers = data.servers
    threshold = data.threshold_seconds
    mu = 60 / service
    offered = arrival / mu
    utilization = arrival / (servers * mu)
    if utilization >= 1:
        raise QueueValidationError(
            'La capacidad es insuficiente para un estado estable. Aumente c o μ, o reduzca λ.'
        )

    # Divide every Erlang term by the largest log-term before summing. This is
    # equivalent to S and B algebraically, but remains finite for large c and a.
    log_terms = [0.0]
    for n in range(1, servers + 1):
        log_terms.append(log_terms[-1] + log(offered) - log(n))
    log_b = log_terms[servers] - log(1 - utilization)
    scale = max(max(log_terms[:servers]), log_b)
    scaled_s = sum(exp(term - scale) for term in log_terms[:servers])
    scaled_b = exp(log_b - scale)
    p0 = exp(-scale) / (scaled_s + scaled_b)
    probability_wait = scaled_b / (scaled_s + scaled_b)
    lq = probability_wait * utilization / (1 - utilization)
    wq_hours = lq / arrival
    w_hours = wq_hours + 1 / mu
    system_size = arrival * w_hours
    service_level = 1 - probability_wait * exp(-(servers * mu - arrival) * threshold / 3600)
    conditional_wait_minutes = 60 / (servers * mu - arrival)

    # S and B are explanatory outputs. They can exceed float range even when the
    # probabilities remain valid, so report infinity instead of overflowing.
    try:
        s = exp(scale) * scaled_s
    except OverflowError:
        s = None
    try:
        b = exp(scale) * scaled_b
    except OverflowError:
        b = None
    metrics = dict(
        service_rate_per_hour=mu, offered_load=offered, utilization=utilization,
        s=s, b=b, p0=p0, probability_wait=probability_wait, lq=lq,
        wq_hours=wq_hours, wq_minutes=wq_hours * 60,
        w_hours=w_hours, w_minutes=w_hours * 60, l=system_size,
        service_level=service_level,
        conditional_wait_minutes=conditional_wait_minutes,
    )
    steps = [
        dict(symbol='μ', formula='60 / s', substitution=f'60 / {service}', result=mu, unit='atenciones/h por asesor'),
        dict(symbol='a', formula='λ / μ', substitution=f'{arrival} / {mu}', result=offered, unit='Erlangs'),
        dict(symbol='ρ', formula='λ / (cμ)', substitution=f'{arrival} / ({servers} × {mu})', result=utilization, unit='proporción'),
        dict(symbol='S', formula='Σ(aⁿ/n!), n=0…c−1', substitution=f'Σ(({offered})ⁿ/n!), n=0…{servers-1}', result=s, unit='adimensional'),
        dict(symbol='B', formula='aᶜ/[c!(1−ρ)]', substitution=f'({offered})^{servers}/[{servers}!(1−{utilization})]', result=b, unit='adimensional'),
        dict(symbol='P₀', formula='1 / (S+B)', substitution=f'1 / ({s if s is not None else "S escalado"}+{b if b is not None else "B escalado"})', result=p0, unit='probabilidad'),
        dict(symbol='Pᵥ', formula='B × P₀', substitution=f'{b if b is not None else "B escalado"} × {p0}', result=probability_wait, unit='probabilidad'),
        dict(symbol='Lq', formula='Pᵥρ / (1−ρ)', substitution=f'{probability_wait} × {utilization} / (1−{utilization})', result=lq, unit='PQR'),
        dict(symbol='Wq', formula='(Lq/λ) × 60', substitution=f'({lq}/{arrival}) × 60', result=wq_hours * 60, unit='min'),
        dict(symbol='W', formula='Wq + 1/μ', substitution=f'{wq_hours * 60} + {service}', result=w_hours * 60, unit='min'),
        dict(symbol='L', formula='λ × W(h)', substitution=f'{arrival} × {w_hours}', result=system_size, unit='PQR'),
        dict(symbol=f'SL{threshold:g}', formula='1−Pᵥe^[−(cμ−λ)t/3600]', substitution=f'1−{probability_wait}e^[−({servers}×{mu}−{arrival})×{threshold}/3600]', result=service_level, unit='probabilidad'),
    ]
    return dict(
        parameters=data.model_dump(), metrics=metrics, steps=steps,
        evidence=dict(arrival_rate='Calculado desde Observado CRC' if data.arrival_evidence == 'calculated_from_crc' else 'Estimado',
                      service_time='Estimado', servers='Estimado', results='Calculado'),
        warnings=[
            'M/M/c supone llegadas Poisson, servicios exponenciales, disciplina FCFS, servidores equivalentes y ausencia de abandono.',
            'Wq promedia todas las llegadas; la espera condicional mostrada corresponde solo a quienes esperan.',
            'El modelo no estima abandono, bloqueo ni resolución legal de PQR.',
        ],
    )


def queue_sensitivity(data: QueueInput, factors=(1.0, 1.25, 1.5), servers=range(2, 6)):
    rows = []
    for factor in factors:
        for count in servers:
            candidate = data.model_copy(update={'arrival_rate_per_hour': data.arrival_rate_per_hour * factor, 'servers': count})
            try:
                result = mmc(candidate)
                rows.append(dict(factor=factor, servers=count, stable=True, **result['metrics']))
            except QueueValidationError:
                rows.append(dict(factor=factor, servers=count, stable=False, utilization=candidate.arrival_rate_per_hour / (count * (60 / candidate.average_service_minutes))))
    return rows


def linear_quantile(values, probability):
    if not values:
        raise QueueValidationError('No hay tasas mensuales para calcular cuantiles.')
    ordered = sorted(values)
    h = (len(ordered) - 1) * probability
    j = floor(h)
    fraction = h - j
    if j >= len(ordered) - 1:
        return ordered[-1]
    return ordered[j] + fraction * (ordered[j + 1] - ordered[j])


def _normalized_header(value):
    plain = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Z0-9]+', '_', plain.upper()).strip('_')


def _integer(value, label, row_number):
    try:
        number = float(str(value).strip().replace(',', '.'))
    except (TypeError, ValueError) as exc:
        raise QueueValidationError(f'Fila {row_number}: {label} no es numérico.') from exc
    if not isfinite(number) or number < 0 or not number.is_integer():
        raise QueueValidationError(f'Fila {row_number}: {label} debe ser un entero finito no negativo.')
    return int(number)


def parse_queue_csv(csv_text, hours_per_day=19):
    """Validate, filter, aggregate and calibrate the one authorized CRC group."""
    sample = csv_text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(StringIO(csv_text.lstrip('\ufeff')), dialect=dialect)
    if not reader.fieldnames:
        raise QueueValidationError('No se encontraron los campos mínimos del recurso de quejas.')
    fields = {_normalized_header(name): name for name in reader.fieldnames if name}
    aliases = {
        'year': ('ANO', 'ANIO'), 'quarter': ('TRIMESTRE',),
        'month': ('MES_DEL_TRIMESTRE', 'MES_TRIMESTRE'), 'provider': ('ID_EMPRESA',),
        'service': ('ID_SERVICIO',), 'channel': ('ID_MEDIO_ATENCION',),
        'complaints': ('NUMERO_QUEJAS', 'NUMERO_DE_QUEJAS'),
    }
    resolved = {key: next((fields[a] for a in choices if a in fields), None) for key, choices in aliases.items()}
    if any(value is None for value in resolved.values()):
        missing = [key for key, value in resolved.items() if value is None]
        raise QueueValidationError('No se encontraron los campos mínimos del recurso de quejas: ' + ', '.join(missing) + '.')
    sensitive = {'CEDULA', 'NUMERO_DOCUMENTO', 'DOCUMENTO_IDENTIDAD', 'CORREO_ELECTRONICO', 'EMAIL_PERSONAL', 'NOMBRE_PERSONA', 'DIRECCION_RESIDENCIA'}
    found_sensitive = sorted(sensitive.intersection(fields))
    if found_sensitive:
        raise QueueValidationError('El archivo contiene columnas personales no admitidas: ' + ', '.join(found_sensitive) + '.')

    monthly = {}
    fingerprints = set()
    repeated = 0
    matching_rows = 0
    total_rows = 0
    for row_number, row in enumerate(reader, start=2):
        if not any(str(value or '').strip() for value in row.values()):
            continue
        total_rows += 1
        year = _integer(row[resolved['year']], 'año', row_number)
        quarter = _integer(row[resolved['quarter']], 'trimestre', row_number)
        month_in_quarter = _integer(row[resolved['month']], 'mes_del_trimestre', row_number)
        provider = _integer(row[resolved['provider']], 'ID_EMPRESA', row_number)
        service = _integer(row[resolved['service']], 'ID_SERVICIO', row_number)
        channel = _integer(row[resolved['channel']], 'ID_MEDIO_ATENCION', row_number)
        complaints = _integer(row[resolved['complaints']], 'NUMERO_QUEJAS', row_number)
        if quarter not in range(1, 5):
            raise QueueValidationError(f'Fila {row_number}: trimestre debe estar entre 1 y 4.')
        if month_in_quarter not in range(1, 4):
            raise QueueValidationError(f'Fila {row_number}: mes_del_trimestre debe estar entre 1 y 3.')
        if year >= 2026:
            raise QueueValidationError('El recurso usa una versión de formato distinta. Revise la homologación antes de combinar.')
        if not (2022 <= year <= 2025 and provider == 800153993 and service == 2 and channel == 2):
            continue
        matching_rows += 1
        fingerprint = tuple(sorted((key, str(value).strip()) for key, value in row.items() if key is not None))
        if fingerprint in fingerprints:
            repeated += 1
        fingerprints.add(fingerprint)
        calendar_month = 3 * (quarter - 1) + month_in_quarter
        key = (year, calendar_month)
        monthly[key] = monthly.get(key, 0) + complaints
    if not monthly:
        raise QueueValidationError('No hay datos para Claro con el servicio, canal y período seleccionados.')

    series = []
    for (year, month), complaints in sorted(monthly.items()):
        days = monthrange(year, month)[1]
        hours = hours_per_day * days
        rate = complaints / hours
        series.append(dict(period=f'{year}-{month:02d}', year=year, month=month, complaints=complaints,
                           calendar_days=days, exposure_hours=hours, arrival_rate_per_hour=rate,
                           provisional=(year == 2025 and month >= 10),
                           evidence=dict(complaints='Calculado desde Observado CRC', exposure='Estimado', rate='Calculado con denominador estimado')))
    all_months = [(year, month) for year in range(2022, 2026) for month in range(1, 13)]
    missing = [f'{year}-{month:02d}' for year, month in all_months if (year, month) not in monthly]
    rates = [row['arrival_rate_per_hour'] for row in series]
    quantiles = {name: linear_quantile(rates, p) for name, p in [('p25', .25), ('p50', .5), ('p75', .75)]}
    dup_column = fields.get('DUP')
    audit = [
        f'{total_rows} filas leídas; {matching_rows} pertenecen al grupo fijo.',
        'Se conservaron todas las tipologías del grupo y se sumó NUMERO_QUEJAS por mes.',
        f'{repeated} filas exactamente repetidas detectadas; no se excluyeron automáticamente.',
        ('La columna DUP está presente; sus valores no se interpretaron ni excluyeron.' if dup_column else 'No se encontró columna DUP; no se aplicó exclusión por esa marca.'),
        f'{len(missing)} meses ausentes; no se imputaron como cero.',
    ]
    return dict(
        filters=dict(provider='Claro/Comcel', provider_id=800153993, service='Telefonía móvil', service_id=2,
                     channel='Línea Telefónica', channel_id=2, period='2022-01 a 2025-12', typologies='Todas'),
        series=series, quantiles=quantiles,
        coverage=dict(observed_months=len(series), expected_months=48, missing_months=missing,
                      method='Interpolación lineal: h=(n−1)p; j=floor(h); x[j]+f(x[j+1]−x[j]).'),
        audit=audit,
        warnings=['2025-T4 se marca como provisional.', 'PQR no equivale a todas las llamadas y la tasa mensual no representa una franja pico.'],
    )
