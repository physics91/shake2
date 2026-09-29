"""Play MIDI events through the Microsoft Synthesizer (dmsynth.dll) and keep what it renders.

Runs on Windows Python (standard library only; DirectMusic, DirectSound and COM through ctypes):

    py -3 capture.py JOB.json OUT.raw

JOB: {"effects": 0 or 1, "seconds": buffer length, "tail": seconds after the last event,
      "patches": [dwPatch, ...], "events": [[seconds, short MIDI message], ...], "dls": path}

The port is IDirectMusic's (v1) default port opened with DirectX 7 sized parameters and no
effects flag, which is what a DirectX 7 performance's AddPort(NULL) gets. Its DirectSound buffer
is ours and plays at DSBVOLUME_MIN, so nothing reaches the speakers. The synthesizer's sink
silences what has played shortly after, so the committed span [play, write) is copied while the
events play. OUT gets little-endian int16 stereo at the port's rate; a JSON line reports the
port's parameters and reverb settings.
"""
import ctypes
import json
import sys
import time
import uuid
from ctypes import POINTER, byref, c_float, c_int32, c_int64, c_long, c_uint16, c_uint32, c_void_p

GUIDS = {
    "CLSID_DirectMusic": "636b9f10-0c7d-11d1-95b2-0020afdc7421",
    "IID_IDirectMusic": "6536115a-7b2d-11d2-ba18-0000f875ac12",
    "CLSID_DirectMusicLoader": "d2ac2892-b39b-11d1-8704-00600893b1bd",
    "IID_IDirectMusicLoader": "2ffaaca2-5dca-11d2-afa6-00aa0024d8b6",
    "CLSID_DirectMusicCollection": "480ff4b0-28b2-11d1-bef7-00c04fbf8fef",
    "IID_IDirectMusicCollection": "d2ac287c-b39b-11d1-8704-00600893b1bd",
    "IID_IKsControl": "28f54685-06fd-11d2-b27a-00a0c9223196",
    "GUID_DMUS_PROP_WavesReverb": "04cb5622-32e5-11d2-afa6-00aa0024d8b6",
    "GUID_DMUS_PROP_Effects": "cda8d611-684a-11d2-871e-00600893b1bd",
}
IUNKNOWN = ["QueryInterface", "AddRef", "Release"]
VTABLES = {
    "IDirectMusic": IUNKNOWN + ["EnumPort", "CreateMusicBuffer", "CreatePort", "EnumMasterClock", "GetMasterClock",
                                "SetMasterClock", "Activate", "GetDefaultPort", "SetDirectSound"],
    "IDirectMusicPort": IUNKNOWN + ["PlayBuffer", "SetReadNotificationHandle", "Read", "DownloadInstrument",
                                    "UnloadInstrument", "GetLatencyClock", "GetRunningStats", "Compact", "GetCaps",
                                    "DeviceIoControl", "SetNumChannelGroups", "GetNumChannelGroups", "Activate",
                                    "SetChannelPriority", "GetChannelPriority", "SetDirectSound", "GetFormat"],
    "IDirectMusicLoader": IUNKNOWN + ["GetObject", "SetObject", "SetSearchDirectory", "ScanDirectory", "CacheObject",
                                      "ReleaseObject", "ClearCache", "EnableCache", "EnumObject"],
    "IDirectMusicCollection": IUNKNOWN + ["GetInstrument", "EnumInstrument"],
    "IDirectMusicBuffer": IUNKNOWN + ["Flush", "TotalTime", "PackStructured", "PackUnstructured", "ResetReadPtr",
                                      "GetNextEvent", "GetRawBufferPtr", "GetStartTime", "GetUsedBytes", "GetMaxBytes",
                                      "GetBufferFormat", "SetStartTime", "SetUsedBytes"],
    "IReferenceClock": IUNKNOWN + ["GetTime", "AdviseTime", "AdvisePeriodic", "Unadvise"],
    "IKsControl": IUNKNOWN + ["KsProperty", "KsMethod", "KsEvent"],
    "IDirectSound": IUNKNOWN + ["CreateSoundBuffer", "GetCaps", "DuplicateSoundBuffer", "SetCooperativeLevel",
                                "Compact", "GetSpeakerConfig", "SetSpeakerConfig", "Initialize"],
    "IDirectSoundBuffer": IUNKNOWN + ["GetCaps", "GetCurrentPosition", "GetFormat", "GetVolume", "GetPan",
                                      "GetFrequency", "GetStatus", "Initialize", "Lock", "Play", "SetCurrentPosition",
                                      "SetFormat", "SetVolume", "SetPan", "SetFrequency", "Stop", "Unlock",
                                      "Restore"],
}

DMUS_PORTPARAMS_CHANNELGROUPS = 2
DMUS_OBJ_CLASS, DMUS_OBJ_FILENAME, DMUS_OBJ_FULLPATH = 2, 0x10, 0x40
DSBCAPS_CTRLVOLUME, DSBCAPS_GLOBALFOCUS, DSBCAPS_GETCURRENTPOSITION2 = 0x80, 0x8000, 0x10000
DSBVOLUME_MIN, DSSCL_PRIORITY, DSBLOCK_ENTIREBUFFER = -10000, 2, 2
KSPROPERTY_TYPE_GET, KSPROPERTY_TYPE_SET = 1, 2


class GUID(ctypes.Structure):
    _fields_ = [("bytes", ctypes.c_ubyte * 16)]

    @classmethod
    def of(cls, name_or_text):
        guid = cls()
        ctypes.memmove(guid.bytes, uuid.UUID(GUIDS.get(name_or_text, name_or_text)).bytes_le, 16)
        return guid


class Com:
    """A raw interface pointer; methods are called by name through its vtable."""

    def __init__(self, ptr, kind):
        self.ptr = ptr.value if isinstance(ptr, c_void_p) else ptr
        self.kind = kind

    def call(self, method, *args, argtypes=None, check=True):
        vtbl = ctypes.cast(c_void_p(self.ptr), POINTER(POINTER(c_void_p))).contents
        types = argtypes if argtypes is not None else [c_void_p] * len(args)
        fn = ctypes.WINFUNCTYPE(c_long, c_void_p, *types)(vtbl[VTABLES[self.kind].index(method)])
        hr = fn(self.ptr, *args)
        if check and hr < 0:
            raise OSError(f"{self.kind}::{method} failed 0x{hr & 0xffffffff:08x}")
        return hr

    def query(self, iid, kind):
        out = c_void_p()
        self.call("QueryInterface", byref(GUID.of(iid)), byref(out))
        return Com(out, kind)


def create(clsid, iid, kind):
    out = c_void_p()
    ctypes.OleDLL("ole32").CoCreateInstance(byref(GUID.of(clsid)), None, 3, byref(GUID.of(iid)), byref(out))
    return Com(out, kind)


class PORTPARAMS7(ctypes.Structure):
    _fields_ = [("dwSize", c_uint32), ("dwValidParams", c_uint32), ("dwVoices", c_uint32), ("dwChannelGroups", c_uint32),
                ("dwAudioChannels", c_uint32), ("dwSampleRate", c_uint32), ("dwEffectFlags", c_uint32), ("fShare", c_uint32)]


class WAVES_REVERB(ctypes.Structure):
    _fields_ = [("fInGain", c_float), ("fReverbMix", c_float), ("fReverbTime", c_float), ("fHighFreqRTRatio", c_float)]


class KSPROPERTY(ctypes.Structure):
    _fields_ = [("Set", GUID), ("Id", c_uint32), ("Flags", c_uint32)]


class WAVEFORMATEX(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("wFormatTag", c_uint16), ("nChannels", c_uint16), ("nSamplesPerSec", c_uint32),
                ("nAvgBytesPerSec", c_uint32), ("nBlockAlign", c_uint16), ("wBitsPerSample", c_uint16),
                ("cbSize", c_uint16)]


class DSBUFFERDESC(ctypes.Structure):
    _fields_ = [("dwSize", c_uint32), ("dwFlags", c_uint32), ("dwBufferBytes", c_uint32), ("dwReserved", c_uint32),
                ("lpwfxFormat", POINTER(WAVEFORMATEX)), ("guid3DAlgorithm", GUID)]


class DMUS_BUFFERDESC(ctypes.Structure):
    _fields_ = [("dwSize", c_uint32), ("dwFlags", c_uint32), ("guidBufferFormat", GUID), ("cbBuffer", c_uint32)]


class DMUS_OBJECTDESC(ctypes.Structure):
    _fields_ = [("dwSize", c_uint32), ("dwValidData", c_uint32), ("guidObject", GUID), ("guidClass", GUID),
                ("ftDate", c_int64), ("vVersion", c_int64), ("wszName", ctypes.c_wchar * 64),
                ("wszCategory", ctypes.c_wchar * 64), ("wszFileName", ctypes.c_wchar * 260),
                ("llMemLength", c_int64), ("pbMemData", c_void_p)]


def ks_property(control, name, data, flags):
    prop = KSPROPERTY(GUID.of(name), 0, flags)
    returned = c_uint32()
    control.call("KsProperty", byref(prop), ctypes.sizeof(prop), byref(data), ctypes.sizeof(data), byref(returned),
                 argtypes=[c_void_p, c_uint32, c_void_p, c_uint32, c_void_p])


def open_port(hwnd):
    ds_ptr = c_void_p()
    ctypes.OleDLL("dsound").DirectSoundCreate(None, byref(ds_ptr), None)
    ds = Com(ds_ptr, "IDirectSound")
    ds.call("SetCooperativeLevel", hwnd, DSSCL_PRIORITY, argtypes=[c_void_p, c_uint32])
    dm = create("CLSID_DirectMusic", "IID_IDirectMusic", "IDirectMusic")
    dm.call("SetDirectSound", ds.ptr, hwnd)
    guid = GUID()
    dm.call("GetDefaultPort", byref(guid))
    params = PORTPARAMS7(ctypes.sizeof(PORTPARAMS7), DMUS_PORTPARAMS_CHANNELGROUPS, 0, 1)
    port_ptr = c_void_p()
    dm.call("CreatePort", byref(guid), byref(params), byref(port_ptr), None)
    return ds, dm, Com(port_ptr, "IDirectMusicPort"), params


def muted_buffer(ds, rate, seconds):
    fmt = WAVEFORMATEX(1, 2, rate, rate * 4, 4, 16, 0)
    desc = DSBUFFERDESC(ctypes.sizeof(DSBUFFERDESC), DSBCAPS_CTRLVOLUME | DSBCAPS_GLOBALFOCUS | DSBCAPS_GETCURRENTPOSITION2,
                        int(seconds * rate) * 4, 0, ctypes.pointer(fmt))
    ptr = c_void_p()
    ds.call("CreateSoundBuffer", byref(desc), byref(ptr), None)
    buffer = Com(ptr, "IDirectSoundBuffer")
    buffer.call("SetVolume", DSBVOLUME_MIN, argtypes=[c_int32])
    # A software buffer's memory stays put; the sink writes it and we read it without locking.
    p1, n1, p2, n2 = c_void_p(), c_uint32(), c_void_p(), c_uint32()
    buffer.call("Lock", 0, 0, byref(p1), byref(n1), byref(p2), byref(n2), DSBLOCK_ENTIREBUFFER,
                argtypes=[c_uint32, c_uint32, c_void_p, c_void_p, c_void_p, c_void_p, c_uint32])
    buffer.call("Unlock", p1, n1, p2, n2, argtypes=[c_void_p, c_uint32, c_void_p, c_uint32])
    return buffer, p1.value, n1.value


def download(port, dls_path, patches):
    loader = create("CLSID_DirectMusicLoader", "IID_IDirectMusicLoader", "IDirectMusicLoader")
    desc = DMUS_OBJECTDESC()
    desc.dwSize = ctypes.sizeof(desc)
    desc.dwValidData = DMUS_OBJ_CLASS | DMUS_OBJ_FILENAME | DMUS_OBJ_FULLPATH
    desc.guidClass = GUID.of("CLSID_DirectMusicCollection")
    desc.wszFileName = dls_path
    coll_ptr = c_void_p()
    loader.call("GetObject", byref(desc), byref(GUID.of("IID_IDirectMusicCollection")), byref(coll_ptr))
    collection = Com(coll_ptr, "IDirectMusicCollection")
    for patch in patches:
        instrument, downloaded = c_void_p(), c_void_p()
        collection.call("GetInstrument", patch, byref(instrument), argtypes=[c_uint32, c_void_p])
        port.call("DownloadInstrument", instrument, byref(downloaded), None, 0,
                  argtypes=[c_void_p, c_void_p, c_void_p, c_uint32])


class Recorder:
    """Copies the committed span [play, write) of the looping buffer as the sink fills it."""

    def __init__(self, buffer, base, size):
        self.buffer, self.base, self.size = buffer, base, size
        self.saved = None
        self.chunks = []

    def poll(self):
        play, write = c_uint32(), c_uint32()
        self.buffer.call("GetCurrentPosition", byref(play), byref(write))
        if self.saved is None:
            self.saved = play.value
        span = (write.value - self.saved) % self.size
        if span == 0 or span > self.size // 2:
            return
        end = self.saved + span
        if end <= self.size:
            self.chunks.append(ctypes.string_at(self.base + self.saved, span))
        else:
            self.chunks.append(ctypes.string_at(self.base + self.saved, self.size - self.saved)
                               + ctypes.string_at(self.base, end - self.size))
        self.saved = end % self.size

    def wait(self, seconds):
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            self.poll()
            time.sleep(0.004)


def main():
    job = json.load(open(sys.argv[1]))
    ctypes.OleDLL("ole32").CoInitialize(None)
    ctypes.windll.winmm.timeBeginPeriod(1)
    hwnd = ctypes.windll.user32.GetDesktopWindow()
    ds, dm, port, params = open_port(hwnd)
    rate = params.dwSampleRate
    buffer, base, size = muted_buffer(ds, rate, float(job["seconds"]))
    port.call("SetDirectSound", ds.ptr, buffer.ptr)

    control = port.query("IID_IKsControl", "IKsControl")
    ks_property(control, "GUID_DMUS_PROP_Effects", c_uint32(int(job["effects"])), KSPROPERTY_TYPE_SET)
    effects, reverb = c_uint32(), WAVES_REVERB()
    ks_property(control, "GUID_DMUS_PROP_Effects", effects, KSPROPERTY_TYPE_GET)
    ks_property(control, "GUID_DMUS_PROP_WavesReverb", reverb, KSPROPERTY_TYPE_GET)
    download(port, job["dls"], job["patches"])

    recorder = Recorder(buffer, base, size)
    port.call("Activate", 1, argtypes=[c_uint32])
    recorder.poll()
    clock_ptr = c_void_p()
    port.call("GetLatencyClock", byref(clock_ptr))
    clock = Com(clock_ptr, "IReferenceClock")
    desc = DMUS_BUFFERDESC(ctypes.sizeof(DMUS_BUFFERDESC), 0, GUID(), 64 * 1024)
    music_ptr = c_void_p()
    dm.call("CreateMusicBuffer", byref(desc), byref(music_ptr), None)
    music = Com(music_ptr, "IDirectMusicBuffer")
    now = c_int64()
    clock.call("GetTime", byref(now))
    start = now.value + 5_000_000  # 0.5 s past the latency clock, in 100 ns units
    events = sorted(job["events"])
    wall = time.perf_counter()
    i = 0
    while i < len(events):
        horizon = time.perf_counter() - wall + 2.0
        packed = 0
        while i < len(events) and events[i][0] <= horizon:
            hr = music.call("PackStructured", c_int64(start + int(events[i][0] * 1e7)), 1, events[i][1],
                            argtypes=[c_int64, c_uint32, c_uint32], check=False)
            if hr < 0:  # full: send what is packed, the rest goes next time
                break
            i += 1
            packed += 1
        if packed:
            port.call("PlayBuffer", music.ptr)
            music.call("Flush")
        recorder.wait(0.2)
    last = events[-1][0] if events else 0.0
    recorder.wait(max(0.0, 0.5 + last + float(job.get("tail", 3.0)) - (time.perf_counter() - wall)))
    port.call("Activate", 0, argtypes=[c_uint32])
    open(sys.argv[2], "wb").write(b"".join(recorder.chunks))
    print(json.dumps({"rate": rate, "voices": params.dwVoices, "audio_channels": params.dwAudioChannels,
                      "port_effects": params.dwEffectFlags, "effects": effects.value,
                      "reverb": [reverb.fInGain, reverb.fReverbMix, reverb.fReverbTime, reverb.fHighFreqRTRatio]}))


if __name__ == "__main__":
    main()
