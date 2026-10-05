"""Validated input contracts, independent of presentation and computation."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[float, Field(allow_inf_nan=False, ge=-1e9, le=1e9)]
Positive = Annotated[float, Field(allow_inf_nan=False, ge=0, le=1e9)]
Percent = Annotated[float, Field(allow_inf_nan=False, ge=0, le=100)]
Probability = Annotated[float, Field(allow_inf_nan=False, ge=0, le=1)]
Count = Annotated[int, Field(strict=True, ge=0, le=1_000_000)]
Name = Annotated[str, Field(min_length=1, max_length=90)]
Row3 = tuple[Number, Number, Number]

class DecisionsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['parameters', 'direct']
    names: tuple[Name, Name, Name]
    base: tuple[Positive, Positive, Positive]
    costs: tuple[Percent, Percent, Percent]
    response: tuple[tuple[Percent, Percent, Percent], tuple[Percent, Percent, Percent], tuple[Percent, Percent, Percent]]
    matrix: tuple[Row3, Row3, Row3]
    probabilities: tuple[Probability, Probability, Probability]
    counts: tuple[tuple[Count, Count], tuple[Count, Count], tuple[Count, Count]]
    alpha: Probability

    @model_validator(mode='after')
    def check_distribution(self):
        if abs(sum(self.probabilities) - 1) > 1e-9:
            raise ValueError('Las probabilidades deben sumar 1 (100 %).')
        if any(sum(row) == 0 for row in self.counts):
            raise ValueError('Cada estado necesita al menos un conteo F o D para estimar P(señal | estado).')
        if any(not n.strip() for n in self.names):
            raise ValueError('Los nombres de las alternativas no pueden estar vacíos.')
        return self

class GameInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    matrix: tuple[tuple[Number, Number], tuple[Number, Number]]


class QueueInput(BaseModel):
    """Validated M/M/c parameters. Units are explicit in the field names."""

    model_config = ConfigDict(extra='forbid')
    arrival_rate_per_hour: Annotated[float, Field(allow_inf_nan=False, gt=0, le=1e7)]
    average_service_minutes: Annotated[float, Field(allow_inf_nan=False, gt=0, le=1e5)]
    servers: Annotated[int, Field(strict=True, gt=0, le=100_000)]
    threshold_seconds: Annotated[float, Field(allow_inf_nan=False, ge=0, le=1e7)]
    arrival_evidence: Literal['estimated', 'calculated_from_crc'] = 'estimated'


class QueueCsvInput(BaseModel):
    """A text-only upload contract; the adapter never persists the supplied CSV."""

    model_config = ConfigDict(extra='forbid')
    csv_text: Annotated[str, Field(min_length=1, max_length=10_000_000)]
    hours_per_day: Annotated[float, Field(allow_inf_nan=False, gt=0, le=24)] = 19
