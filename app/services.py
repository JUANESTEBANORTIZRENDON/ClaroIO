"""Pure calculation functions: no UI, files, session state, or rounded inputs."""
from math import isclose
from app.models import DecisionsInput, GameInput

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
