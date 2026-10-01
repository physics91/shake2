import struct

import pytest

from dls_builders import art1, build_dls, chunk, instrument, list_chunk, region, sine, wave, wsmp
from shakefmt.dls import DlsFormatError, decode_dls, find_instrument, find_region


def small_collection():
    piano = instrument(
        0,
        [
            region(key=(0, 59), wave=0, sample=wsmp(unity=48, fine=-10, loop=(100, 400))),
            region(key=(60, 127), wave=1),
        ],
        name="Piano",
        articulation=art1((0, 0, 0x0206, 0, -123456)),
    )
    drums = instrument(0, [region(key=(35, 36), wave=1, key_group=1)], drums=True, name="Standard")
    return build_dls(
        [piano, drums],
        [
            wave(sine(440, 0.1), rate=22050),
            wave(sine(880, 0.05), rate=11025, bits=8, sample=wsmp(unity=69, atten=-65536)),
        ],
    )


def test_decodes_instruments_regions_and_articulation():
    col = decode_dls(small_collection())

    piano, drums = col.instruments
    assert (piano.name, piano.bank, piano.program, piano.drums) == ("Piano", 0, 0, False)
    assert drums.drums is True
    assert [(r.key_lo, r.key_hi, r.wave_index) for r in piano.regions] == [(0, 59, 0), (60, 127, 1)]
    assert piano.articulation[0].destination == 0x0206
    assert piano.articulation[0].scale == -123456
    assert piano.regions[0].sample.unity_note == 48
    assert piano.regions[0].sample.fine_tune == -10
    assert piano.regions[0].sample.loop == (100, 400)
    assert drums.regions[0].key_group == 1


def test_decodes_waves_as_float_pcm_with_their_default_sample_settings():
    col = decode_dls(small_collection())

    first, second = col.waves
    assert first.rate == 22050 and len(first.pcm) == 2205
    assert abs(float(first.pcm.max()) - 0.5) < 0.01
    assert second.rate == 11025 and abs(float(second.pcm.max()) - 0.5) < 0.02
    assert second.sample.unity_note == 69 and second.sample.attenuation == -65536
    assert first.sample is None


def test_region_sample_falls_back_to_wave_sample():
    col = decode_dls(small_collection())
    piano = col.instruments[0]

    assert col.sample_for(piano.regions[1]).unity_note == 69
    assert col.sample_for(piano.regions[0]).unity_note == 48


def test_lookup_prefers_exact_bank_and_falls_back_to_bank_zero():
    col = decode_dls(small_collection())

    assert find_instrument(col, bank=0, program=0, drums=False).name == "Piano"
    assert find_instrument(col, bank=8 << 7, program=0, drums=False).name == "Piano"
    assert find_instrument(col, bank=0, program=5, drums=True).name == "Standard"
    assert find_instrument(col, bank=0, program=99, drums=False) is None
    assert find_region(col.instruments[0], key=72, velocity=100).wave_index == 1


def test_rejects_non_dls_data():
    with pytest.raises(DlsFormatError):
        decode_dls(b"RIFF\x04\x00\x00\x00WAVE")


def cues_cut_short():
    """ptbl claims two cues but holds one offset."""
    body = b"DLS " + chunk(b"colh", struct.pack("<I", 1)) + list_chunk(b"lins", instrument(0, [region()]))
    body += list_chunk(b"wvpl", wave(sine(440, 0.01)))
    body += chunk(b"ptbl", struct.pack("<III", 8, 2, 0))
    return b"RIFF" + struct.pack("<I", len(body)) + body


def connections_cut_short():
    """art1 claims 1000 connections but holds one."""
    body = struct.pack("<II", 8, 1000) + struct.pack("<HHHHi", 0, 0, 0x206, 0, 0)
    art = list_chunk(b"lart", chunk(b"art1", body))
    return build_dls([instrument(0, [region()], articulation=art)], [wave(sine(440, 0.01))])


def loop_record_past_its_chunk():
    """wsmp's cbSize puts its loop record far past the chunk."""
    sample = chunk(b"wsmp", struct.pack("<IHhiII", 0x100000, 60, 0, 0, 0, 1))
    return build_dls([instrument(0, [region(sample=sample)])], [wave(sine(440, 0.01))])


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(cues_cut_short(), id="ptbl-cues"),
        pytest.param(connections_cut_short(), id="art1-connections"),
        pytest.param(loop_record_past_its_chunk(), id="wsmp-loop-record"),
        pytest.param(build_dls([instrument(0, [region(wave=5)])], [wave(sine(440, 0.01))]), id="missing-wave"),
        pytest.param(build_dls([instrument(0, [region()])], [wave(sine(440, 0.01), rate=0)]), id="zero-rate"),
        pytest.param(
            build_dls([instrument(0, [region(sample=wsmp(loop=(0, 1000)))])], [wave(sine(440, 0.01))]),
            id="loop-past-region-wave",
        ),
        pytest.param(
            build_dls([instrument(0, [region()])], [wave(sine(440, 0.01), sample=wsmp(loop=(200, 100)))]),
            id="loop-past-wave",
        ),
    ],
)
def test_rejects_records_past_their_chunk_and_references_rendering_cannot_follow(data):
    with pytest.raises(DlsFormatError):
        decode_dls(data)


def test_a_name_outside_cp1252_does_not_reject_the_collection():
    named = list_chunk(
        b"ins ",
        chunk(b"insh", struct.pack("<III", 1, 0, 0)),
        list_chunk(b"lrgn", region()),
        list_chunk(b"INFO", chunk(b"INAM", "갂".encode("cp949") + b"\0")),
    )
    col = decode_dls(build_dls([named], [wave(sine(440, 0.01))]))

    assert col.instruments[0].name == "\ufffdA"
