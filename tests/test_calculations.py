"""Numerical regression, independent invariants and sensitive edge cases."""
import copy
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.models import DecisionsInput, GameInput
from app.services import decisions, game

DATA = json.loads((Path(__file__).resolve().parents[1]/'data/initial.json').read_text(encoding='utf-8'))

@pytest.fixture
def original():
    return copy.deepcopy(DATA['decisions'])

def calc(payload):
    return decisions(DecisionsInput(**payload))

def solve(matrix):
    return game(GameInput(matrix=matrix))

def test_original_decisions(original):
    r=calc(original)
    assert r['expected'] == pytest.approx([1.780332318365,1.810189893667,.273394294926])
    assert {k:v['winners'] for k,v in r['criteria'].items()} == {
        'maximax':[0], 'maximin':[1], 'laplace':[1], 'hurwicz':[0], 'savage':[0]}
    assert r['winners']==[1]
    assert r['perfect']==pytest.approx(3.608670559039)
    assert r['evpi']==pytest.approx(1.798480665372)
    assert r['signal_value']==pytest.approx(2.467320855770)
    assert r['evsi']==pytest.approx(.657130962103)
    assert r['efficiency']==pytest.approx(.365381165756)
    assert r['signals'][0]['posterior']==pytest.approx([4/9,3/9,2/9])
    assert r['signals'][1]['posterior']==pytest.approx([1/7,2/7,4/7])
    assert [s['winners'] for s in r['signals']]==[[1],[0]]
    assert min(r['eol'])==pytest.approx(r['evpi'])
    assert sum(s['probability'] for s in r['signals'])==pytest.approx(1)

def test_parameter_and_direct_sources(original):
    original['matrix']=[[99]*3 for _ in range(3)]
    assert calc(original)['winners']==[1]
    original['response'][0]=[20]*3
    assert calc(original)['winners']==[0]
    original['mode']='direct'
    result=calc(original)
    assert result['expected']==[99]*3
    assert result['winners']==[0,1,2]
    assert result['evpi']==0
    assert result['evsi']==0
    assert result['efficiency'] is None
    assert all(c['winners']==[0,1,2] for c in result['criteria'].values())

def test_new_prior_reweights_likelihood_and_bayes(original):
    original['probabilities']=[.1,.2,.7]
    r=calc(original)
    pf=.1*.8+.2*.6+.7/3
    assert r['signals'][0]['probability']==pytest.approx(pf)
    assert r['signals'][0]['posterior'][2]==pytest.approx((.7/3)/pf)
    assert r['winners']==[0]
    assert 0 <= r['evsi'] <= r['evpi']+1e-12

def test_impossible_signal_and_certain_state(original):
    original['counts']=[[5,0],[5,0],[6,0]]
    r=calc(original)
    assert r['signals'][1]['posterior'] is None
    assert r['signals'][1]['expected'] is None
    assert r['signals'][1]['winners']==[]
    assert r['evsi']==pytest.approx(0)
    original['probabilities']=[0,0,1]
    assert calc(original)['evpi']==pytest.approx(0)

@pytest.mark.parametrize('probabilities', [[.3,.3,.3],[-.1,.5,.6],[0,0,2],[float('nan'),0,1],[float('inf'),0,0]])
def test_invalid_probabilities(original,probabilities):
    original['probabilities']=probabilities
    with pytest.raises(ValidationError): calc(original)

@pytest.mark.parametrize('counts', [[[0,0],[1,2],[2,3]], [[1.5,2],[1,2],[2,3]], [[-1,2],[1,2],[2,3]]])
def test_invalid_counts(original,counts):
    original['counts']=counts
    with pytest.raises(ValidationError): calc(original)

def test_negative_payoffs_and_hurwicz_endpoints(original):
    original['mode']='direct';original['matrix']=[[-10,-5,-1],[-4,-4,-4],[-6,-5,-3]]
    original['alpha']=0
    r=calc(original)
    assert r['criteria']['hurwicz']==r['criteria']['maximin']
    assert r['winners']==[1]
    original['alpha']=1
    r=calc(original)
    assert r['criteria']['hurwicz']==r['criteria']['maximax']
    assert min(r['eol'])==pytest.approx(r['evpi'])

def test_original_historical_game():
    r=solve(DATA['games']['historical'])
    assert r['saddles']==[[0,0]]
    assert r['value']==pytest.approx(153.61766666666667)
    assert r['maximin']==r['minimax']
    assert r['mixed'] is None
    assert {(d['player'],d['strategy'],d['kind']) for d in r['dominance']}=={('claro',0,'estricta'),('tigo',0,'estricta')}

def test_original_mixed_game_and_indifference():
    m=DATA['games']['hypothetical'];r=solve(m);mix=r['mixed'];p,q=mix['p'],mix['q']
    assert not r['saddles']
    assert p==pytest.approx(.6798202377500725)
    assert q==pytest.approx(.4345897361554073)
    assert r['value']==pytest.approx(253.57651087271674)
    assert p*m[0][0]+(1-p)*m[1][0]==pytest.approx(p*m[0][1]+(1-p)*m[1][1])
    assert q*m[0][0]+(1-q)*m[0][1]==pytest.approx(q*m[1][0]+(1-q)*m[1][1])

@pytest.mark.parametrize('matrix,saddles', [([[2,2],[2,2]],[[0,0],[0,1],[1,0],[1,1]]),([[2,2],[1,1]],[[0,0],[0,1]]),([[1,2],[1,2]],[[0,0],[1,0]]),([[1,2],[3,4]],[[1,0]]),([[0,0],[0,1]],[[0,0],[1,0]])])
def test_degenerate_tied_and_edited_games(matrix,saddles):
    r=solve(matrix)
    assert r['saddles']==saddles
    assert r['mixed'] is None
    assert r['type']=='pure'

def test_matching_pennies_and_negative_value():
    r=solve([[1,-1],[-1,1]])
    assert r['mixed']['p']==r['mixed']['q']==.5
    assert r['value']==0
    assert solve([[-9,-11],[-11,-9]])['value']==-10

def test_dominance_weak_and_equivalent():
    r=solve([[2,3],[2,1]])
    assert any(d['kind']=='débil' and d['player']=='claro' for d in r['dominance'])
    assert solve([[2,2],[2,2]])['dominance']==[]

def test_api_contract(original):
    with TestClient(app) as c:
        assert c.get('/').status_code==200
        assert c.get('/api/health').json()=={'status':'ok'}
        assert c.get('/api/initial').json()['decisions']['counts']==[[4,1],[3,2],[2,4]]
        assert c.post('/api/decisions',json=original).json()['winners']==[1]
        assert c.post('/api/game',json={'matrix':[[1,2],[3,4]]}).json()['saddles']==[[1,0]]
        original['probabilities']=[0,0,0]
        assert c.post('/api/decisions',json=original).status_code==422
        assert c.post('/api/game',json={'matrix':[[1,2],[3,None]]}).status_code==422
        assert c.get('/api/sources/VOZ_MOVIL_ABONADOS_1.csv').status_code==404
        assert c.get('/static/app.js').status_code==200

def test_laplace_does_not_use_priors(original):
    reference=calc(original)['criteria']['laplace']
    original['probabilities']=[0,1,0]
    assert calc(original)['criteria']['laplace']==reference
