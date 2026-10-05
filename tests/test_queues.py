"""M/M/c acceptance, CSV adapter traceability, and queue API regression."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import QueueInput
from app.services import QueueValidationError, linear_quantile, mmc, parse_queue_csv, queue_sensitivity


def queue(arrival=8, service=8, servers=3, threshold=30):
    return QueueInput(arrival_rate_per_hour=arrival, average_service_minutes=service,
                      servers=servers, threshold_seconds=threshold)


def test_base_acceptance_values_and_units():
    result = mmc(queue())
    m = result['metrics']
    assert m['service_rate_per_hour'] == pytest.approx(7.5)
    assert m['offered_load'] == pytest.approx(1.066666667)
    assert m['utilization'] == pytest.approx(.355555556)
    assert m['s'] == pytest.approx(2.635555556)
    assert m['b'] == pytest.approx(.313869732)
    assert m['p0'] == pytest.approx(.339049104)
    assert m['probability_wait'] == pytest.approx(.106417251)
    assert m['lq'] == pytest.approx(.058712966)
    assert m['wq_minutes'] == pytest.approx(.440347246)
    assert m['w_minutes'] == pytest.approx(8.440347246)
    assert m['l'] == pytest.approx(1.125379633)
    assert m['service_level'] == pytest.approx(.905694985)
    assert [step['symbol'] for step in result['steps']] == ['μ','a','ρ','S','B','P₀','Pᵥ','Lq','Wq','W','L','SL30']


def test_little_identities_and_four_servers():
    m = mmc(queue(servers=4))['metrics']
    assert m['wq_minutes'] == pytest.approx(.068902001)
    assert m['service_level'] == pytest.approx(.978967902)
    assert m['lq'] == pytest.approx(8 * m['wq_hours'])
    assert m['l'] == pytest.approx(8 * m['w_hours'])


@pytest.mark.parametrize('arrival,service,servers', [(22.5,8,3),(18,10,3)])
def test_rejects_unstable_capacity(arrival,service,servers):
    with pytest.raises(QueueValidationError, match='capacidad es insuficiente'):
        mmc(queue(arrival,service,servers))


def test_sensitivity_and_numerical_stability():
    rows = queue_sensitivity(queue(), factors=(1,))
    assert [row['servers'] for row in rows] == [2,3,4,5]
    assert all(row['stable'] for row in rows)
    waits = [row['wq_minutes'] for row in rows]
    assert waits == sorted(waits, reverse=True)
    large = mmc(queue(arrival=4500, service=1, servers=100, threshold=20))['metrics']
    assert 0 <= large['probability_wait'] <= 1
    assert 0 <= large['service_level'] <= 1


def test_linear_quantiles_use_required_interpolation():
    assert linear_quantile([5,8,12],.25) == pytest.approx(6.5)
    assert linear_quantile([5,8,12],.5) == 8
    assert linear_quantile([5,8,12],.75) == 10
    assert linear_quantile([5,8,12],1) == 12


def sample_csv():
    return """ANO;TRIMESTRE;MES_DEL_TRIMESTRE;ID_EMPRESA;ID_SERVICIO;ID_MEDIO_ATENCION;TIPOLOGIA;NUMERO_QUEJAS;DUP
2022;1;1;800153993;2;2;A;1000;
2022;1;1;800153993;2;2;B;1945;
2022;1;2;800153993;2;2;A;4256;
2022;1;3;800153993;2;2;C;7068;
2022;1;1;999;2;2;A;999999;
2022;1;1;800153993;1;2;A;999999;
2022;1;1;800153993;2;7;A;999999;
"""


def test_csv_exclusive_filter_all_typologies_coverage_and_quantiles():
    result = parse_queue_csv(sample_csv())
    assert [row['complaints'] for row in result['series']] == [2945,4256,7068]
    assert [row['arrival_rate_per_hour'] for row in result['series']] == pytest.approx([5,8,12])
    assert result['quantiles'] == pytest.approx({'p25':6.5,'p50':8,'p75':10})
    assert result['coverage']['observed_months'] == 3
    assert result['coverage']['expected_months'] == 48
    assert len(result['coverage']['missing_months']) == 45
    assert result['filters']['provider_id'] == 800153993
    assert result['filters']['typologies'] == 'Todas'
    assert any('DUP está presente' in item for item in result['audit'])


def test_duplicate_is_logged_but_not_silently_excluded():
    header, row = sample_csv().splitlines()[:2]
    result = parse_queue_csv('\n'.join([header,row,row]))
    assert result['series'][0]['complaints'] == 2000
    assert any('1 filas exactamente repetidas' in item for item in result['audit'])


@pytest.mark.parametrize('replacement,message', [
    (('TRIMESTRE','OTRO'),'campos mínimos'),
    (('2022;1;1','2022;5;1'),'trimestre debe estar'),
    (('2022;1;1','2022;1;4'),'mes_del_trimestre debe estar'),
    (('2022;1;1','2026;1;1'),'versión de formato distinta'),
    (('1945','-1'),'entero finito no negativo'),
])
def test_invalid_csv(replacement,message):
    with pytest.raises(QueueValidationError, match=message):
        parse_queue_csv(sample_csv().replace(*replacement))


def test_queue_api_sources_and_existing_pages_remain_available():
    with TestClient(app) as client:
        response=client.post('/api/queues/mmc/calculate',json=queue().model_dump())
        assert response.status_code == 200
        assert len(response.json()['sensitivity']) == 12
        public_payload=queue().model_dump() | {'arrival_evidence':'calculated_from_crc'}
        assert client.post('/api/queues/mmc/calculate',json=public_payload).json()['evidence']['arrival_rate'] == 'Calculado desde Observado CRC'
        assert client.post('/api/queues/mmc/calculate',json=queue(4500,1,100,20).model_dump()).status_code == 200
        assert client.post('/api/queues/mmc/calculate',json=queue(22.5).model_dump()).status_code == 422
        parsed=client.post('/api/queues/context/parse',json={'csv_text':sample_csv(),'hours_per_day':19})
        assert parsed.status_code == 200
        sources=client.get('/api/queues/sources').json()
        assert [source['code'] for source in sources] == [f'F{i}' for i in range(1,10)]
        page=client.get('/static/references.js').text
        assert 'institutionalReferences' in page
        assert 'queue_sources' in page
        assert client.get('/api/initial').json()['games']
