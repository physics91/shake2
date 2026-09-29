// Plays one MIDI file the way shake.exe does (0x43f850, 0x43fa00, 0x43fc40) on this PC's 32-bit
// DirectMusic and keeps what the default port renders, muted. 64-bit Windows has no dmime.dll, so
// this is C# built for x86 with the .NET Framework compiler that ships with Windows:
//
//   C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /platform:x86 segment32.cs
//   segment32.exe [--dls=C:\full\path.dls] DIR FILE EFFECTS REPEATS TAIL MAX_SECONDS OUT.raw [PRELOAD_DIR A.mid,B.mid,...]
//
// --dls registers that file with the loader as the default GM collection, so the segment's band
// downloads test instruments by program number (a measurement aid; the game never does this).
//
// The only change to the game's path: the default port's DirectSound buffer is replaced by ours at
// DSBVOLUME_MIN (deactivate, SetDirectSound, activate) and the reverb flag is set to EFFECTS. The
// preload list loads and downloads segments first and keeps them, as the game does with TBWAIT11,
// TBWAIT22 and TB19. OUT gets little-endian int16 stereo at the port's rate; a JSON line reports the
// port, the segment length, the channel priorities and the synth's running stats.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class Segment32 {
    [DllImport("ole32.dll")] static extern int CoInitialize(IntPtr r);
    [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid clsid, IntPtr outer, uint ctx, ref Guid iid, out IntPtr obj);
    [DllImport("dsound.dll")] static extern int DirectSoundCreate(IntPtr guid, out IntPtr ds, IntPtr outer);
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);

    const CallingConvention Std = CallingConvention.StdCall;
    [UnmanagedFunctionPointer(Std)] delegate int PtrPtr(IntPtr self, IntPtr a, IntPtr b);
    [UnmanagedFunctionPointer(Std)] delegate int PtrPtrPtr(IntPtr self, IntPtr a, IntPtr b, IntPtr c);
    [UnmanagedFunctionPointer(Std)] delegate int PtrUint(IntPtr self, IntPtr a, uint b);
    [UnmanagedFunctionPointer(Std)] delegate int Create3(IntPtr self, IntPtr desc, out IntPtr obj, IntPtr outer);
    [UnmanagedFunctionPointer(Std)] delegate int Int1(IntPtr self, int value);
    [UnmanagedFunctionPointer(Std)] delegate int Ptr1(IntPtr self, IntPtr value);
    [UnmanagedFunctionPointer(Std)] delegate int NoArgs(IntPtr self);
    [UnmanagedFunctionPointer(Std)] delegate int Lock(IntPtr self, uint offset, uint bytes, out IntPtr p1, out uint n1, out IntPtr p2, out uint n2, uint flags);
    [UnmanagedFunctionPointer(Std)] delegate int Unlock(IntPtr self, IntPtr p1, uint n1, IntPtr p2, uint n2);
    [UnmanagedFunctionPointer(Std)] delegate int Position(IntPtr self, out uint play, out uint write);
    [UnmanagedFunctionPointer(Std)] delegate int QueryInterface(IntPtr self, ref Guid iid, out IntPtr obj);
    [UnmanagedFunctionPointer(Std)] delegate int KsProperty(IntPtr self, IntPtr prop, uint propLen, IntPtr data, uint dataLen, out uint returned);
    [UnmanagedFunctionPointer(Std)] delegate int GetObject(IntPtr self, IntPtr desc, ref Guid iid, out IntPtr obj);
    [UnmanagedFunctionPointer(Std)] delegate int SetSearchDirectory(IntPtr self, ref Guid cls, [MarshalAs(UnmanagedType.LPWStr)] string dir, int clear);
    [UnmanagedFunctionPointer(Std)] delegate int SetParam(IntPtr self, ref Guid type, uint groups, uint index, int time, IntPtr param);
    [UnmanagedFunctionPointer(Std)] delegate int Uint1(IntPtr self, uint value);
    [UnmanagedFunctionPointer(Std)] delegate int OutInt(IntPtr self, out int value);
    [UnmanagedFunctionPointer(Std)] delegate int PlaySegment(IntPtr self, IntPtr seg, uint flags, long start, out IntPtr state);
    [UnmanagedFunctionPointer(Std)] delegate int Stop(IntPtr self, IntPtr seg, IntPtr state, int time, uint flags);
    [UnmanagedFunctionPointer(Std)] delegate int PChannelInfo(IntPtr self, uint pch, out IntPtr port, out uint group, out uint mch);
    [UnmanagedFunctionPointer(Std)] delegate int GetChannelPriority(IntPtr self, uint group, uint channel, out uint priority);
    [UnmanagedFunctionPointer(Std)] delegate int GetTime(IntPtr self, out long rt, out int mt);
    [UnmanagedFunctionPointer(Std)] delegate int GetStartTime(IntPtr self, out int mt);

    static readonly Guid CLSID_Performance = new Guid("d2ac2881-b39b-11d1-8704-00600893b1bd");
    static readonly Guid IID_Performance = new Guid("07d43d03-6523-11d2-871d-00600893b1bd");
    static readonly Guid CLSID_Loader = new Guid("d2ac2892-b39b-11d1-8704-00600893b1bd");
    static readonly Guid IID_Loader = new Guid("2ffaaca2-5dca-11d2-afa6-00aa0024d8b6");
    static readonly Guid AllTypes = new Guid("d2ac2893-b39b-11d1-8704-00600893b1bd");
    static readonly Guid CLSID_Segment = new Guid("d2ac2882-b39b-11d1-8704-00600893b1bd");
    static readonly Guid IID_Segment = new Guid("f96029a2-4282-11d2-8717-00600893b1bd");
    static readonly Guid StandardMIDIFile = new Guid("06621075-e92e-11d1-a8c5-00c04fa3726e");
    static readonly Guid Download = new Guid("d2ac28a7-b39b-11d1-8704-00600893b1bd");
    static readonly Guid DefaultGMCollection = new Guid("f17e8673-c3b4-11d1-870b-00600893b1bd");
    static readonly Guid CLSID_Collection = new Guid("480ff4b0-28b2-11d1-bef7-00c04fbf8fef");

    static T Slot<T>(IntPtr obj, int index) where T : class {
        IntPtr vtable = Marshal.ReadIntPtr(obj);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vtable, index * IntPtr.Size), typeof(T)) as T;
    }

    static int Check(int hr, string what) {
        if (hr < 0) throw new Exception(what + " failed 0x" + hr.ToString("x8"));
        return hr;
    }

    static IntPtr Alloc(int size) {
        IntPtr p = Marshal.AllocHGlobal(size);
        for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
        return p;
    }

    static uint Property(IntPtr control, string set, uint flags, IntPtr data, uint size) {
        IntPtr prop = Alloc(24);
        Marshal.Copy(new Guid(set).ToByteArray(), 0, prop, 16);
        Marshal.WriteInt32(prop, 20, (int)flags);
        uint returned;
        Check(Slot<KsProperty>(control, 3)(control, prop, 24, data, size, out returned), "KsProperty " + set);
        return returned;
    }

    static int Main(string[] args) {
        string dls = null;
        if (args[0].StartsWith("--dls=")) {
            dls = args[0].Substring(6);
            args = new List<string>(args).GetRange(1, args.Length - 1).ToArray();
        }
        string dir = args[0], file = args[1];
        int effects = int.Parse(args[2]);
        uint repeats = uint.Parse(args[3]);
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        double tail = double.Parse(args[4], inv), maxSeconds = double.Parse(args[5], inv);
        CoInitialize(IntPtr.Zero);
        timeBeginPeriod(1);
        IntPtr hwnd = GetDesktopWindow();
        IntPtr ds;
        Check(DirectSoundCreate(IntPtr.Zero, out ds, IntPtr.Zero), "DirectSoundCreate");
        Check(Slot<PtrUint>(ds, 6)(ds, hwnd, 2), "SetCooperativeLevel");

        // 0x43f850
        Guid c = CLSID_Performance, i = IID_Performance;
        IntPtr perf;
        Check(CoCreateInstance(ref c, IntPtr.Zero, 3, ref i, out perf), "CoCreateInstance Performance");
        Check(Slot<PtrPtrPtr>(perf, 3)(perf, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero), "Init(NULL, NULL, NULL)");
        Check(Slot<Ptr1>(perf, 24)(perf, IntPtr.Zero), "AddPort(NULL)");
        c = CLSID_Loader; i = IID_Loader;
        IntPtr loader;
        Check(CoCreateInstance(ref c, IntPtr.Zero, 3, ref i, out loader), "CoCreateInstance Loader");
        if (dls != null) {
            // DMUS_OBJECTDESC: DMUS_OBJ_OBJECT | DMUS_OBJ_CLASS | DMUS_OBJ_FILENAME | DMUS_OBJ_FULLPATH.
            IntPtr gm = Alloc(0x350);
            Marshal.WriteInt32(gm, 0, 0x350);
            Marshal.WriteInt32(gm, 4, 0x33);
            Marshal.Copy(DefaultGMCollection.ToByteArray(), 0, gm + 8, 16);
            Marshal.Copy(CLSID_Collection.ToByteArray(), 0, gm + 24, 16);
            char[] path = dls.ToCharArray();
            Marshal.Copy(path, 0, gm + 312, path.Length);
            Check(Slot<Ptr1>(loader, 4)(loader, gm), "Loader::SetObject " + dls);
        }

        IntPtr port; uint group, mch;
        Check(Slot<PChannelInfo>(perf, 28)(perf, 0, out port, out group, out mch), "PChannelInfo(0)");
        var priorities = new List<string>();
        for (uint ch = 0; ch < 16; ch++) {
            uint priority;
            int hr = Slot<GetChannelPriority>(port, 17)(port, 1, ch, out priority);
            priorities.Add(hr < 0 ? "\"0x" + hr.ToString("x8") + "\"" : "\"0x" + priority.ToString("x8") + "\"");
        }

        // Our muted buffer in place of the port's own.
        IntPtr fmtOut = Alloc(18); uint fmtSize = 18, bufferSize;
        Check(Slot<GetFormatDelegate>(port, 19)(port, fmtOut, ref fmtSize, out bufferSize), "GetFormat");
        int rate = Marshal.ReadInt32(fmtOut, 4);
        int deactivate = Slot<Int1>(port, 15)(port, 0);
        IntPtr fmt = Alloc(18);
        Marshal.WriteInt16(fmt, 0, 1); Marshal.WriteInt16(fmt, 2, 2); Marshal.WriteInt32(fmt, 4, rate);
        Marshal.WriteInt32(fmt, 8, rate * 4); Marshal.WriteInt16(fmt, 12, 4); Marshal.WriteInt16(fmt, 14, 16);
        int size = 4 * rate * 4;
        IntPtr desc = Alloc(36);
        Marshal.WriteInt32(desc, 0, 36);
        Marshal.WriteInt32(desc, 4, 0x80 | 0x8000 | 0x10000);
        Marshal.WriteInt32(desc, 8, size);
        Marshal.WriteIntPtr(desc, 16, fmt);
        IntPtr buffer;
        Check(Slot<Create3>(ds, 3)(ds, desc, out buffer, IntPtr.Zero), "CreateSoundBuffer");
        Check(Slot<Int1>(buffer, 15)(buffer, -10000), "SetVolume");
        IntPtr p1, p2; uint n1, n2;
        Check(Slot<Lock>(buffer, 11)(buffer, 0, 0, out p1, out n1, out p2, out n2, 2), "Lock");
        Check(Slot<Unlock>(buffer, 19)(buffer, p1, n1, p2, n2), "Unlock");
        Check(Slot<PtrPtr>(port, 18)(port, ds, buffer), "IDirectMusicPort::SetDirectSound");

        Guid ksIid = new Guid("28f54685-06fd-11d2-b27a-00a0c9223196");
        IntPtr control;
        Check(Slot<QueryInterface>(port, 0)(port, ref ksIid, out control), "QueryInterface IKsControl");
        IntPtr flags = Alloc(4);
        Property(control, "cda8d611-684a-11d2-871e-00600893b1bd", 1, flags, 4);
        int effectsBefore = Marshal.ReadInt32(flags, 0);
        Marshal.WriteInt32(flags, 0, effects);
        Property(control, "cda8d611-684a-11d2-871e-00600893b1bd", 2, flags, 4);
        Property(control, "cda8d611-684a-11d2-871e-00600893b1bd", 1, flags, 4);

        var chunks = new List<byte[]>();
        long saved = -1, total = 0;
        IntPtr bufferBase = p1;
        Action poll = () => {
            uint play, write;
            Slot<Position>(buffer, 4)(buffer, out play, out write);
            if (saved < 0) saved = play;
            long span = ((long)write - saved + size) % size;
            if (span == 0 || span > size / 2) return;
            byte[] chunk = new byte[span];
            long first = Math.Min(span, size - saved);
            Marshal.Copy(bufferBase + (int)saved, chunk, 0, (int)first);
            if (first < span) Marshal.Copy(bufferBase, chunk, (int)first, (int)(span - first));
            chunks.Add(chunk);
            total += span;
            saved = (saved + span) % size;
        };
        var watch = Stopwatch.StartNew();
        Action<double> wait = (secs) => {
            double until = watch.Elapsed.TotalSeconds + secs;
            while (watch.Elapsed.TotalSeconds < until) { poll(); Thread.Sleep(4); }
        };
        Check(Slot<Int1>(port, 15)(port, 1), "Activate");
        wait(0.5);

        // 0x43f850 loads and downloads TBWAIT11, TBWAIT22 and TB19 from \\sound at start; they stay
        // loaded for the program's life, so their instruments stay on the port.
        var kept = new List<IntPtr>();
        if (args.Length > 8)
            foreach (string pre in args[8].Split(','))
                kept.Add(Load(loader, perf, args[7], pre, 10000));
        IntPtr seg = Load(loader, perf, dir, file, repeats);
        int length;
        Slot<OutInt>(seg, 3)(seg, out length);

        wait(0.3);
        long before = total;
        IntPtr state;
        Check(Slot<PlaySegment>(perf, 4)(perf, seg, 0, 0, out state), "PlaySegment");
        double playWall = watch.Elapsed.TotalSeconds;
        poll();
        long after = total;
        double limit = watch.Elapsed.TotalSeconds + maxSeconds;
        while (watch.Elapsed.TotalSeconds < limit) {
            wait(0.05);
            // Queued behind the prepare time the segment is not playing yet.
            if (watch.Elapsed.TotalSeconds - playWall > 1.0 && Slot<PtrPtr>(perf, 14)(perf, seg, IntPtr.Zero) != 0) break;
        }
        double ended = watch.Elapsed.TotalSeconds - playWall;
        wait(tail);
        IntPtr stats = Alloc(32);
        Marshal.WriteInt32(stats, 0, 32);
        int statsHr = Slot<Ptr1>(port, 9)(port, stats);
        Slot<Stop>(perf, 5)(perf, IntPtr.Zero, IntPtr.Zero, 0, 0);
        wait(0.2);
        Slot<Int1>(port, 15)(port, 0);
        Slot<NoArgs>(perf, 38)(perf);
        using (var f = File.Create(args[6]))
            foreach (var chunk in chunks) f.Write(chunk, 0, chunk.Length);
        Console.WriteLine("{\"rate\": " + rate + ", \"group\": " + group + ", \"mch\": " + mch
            + ", \"deactivate\": \"0x" + deactivate.ToString("x8") + "\""
            + ", \"effects_before\": " + effectsBefore + ", \"effects\": " + Marshal.ReadInt32(flags, 0)
            + ", \"length_mt\": " + length + ", \"play_frames\": [" + before / 4 + ", " + after / 4 + "]"
            + ", \"ended_s\": " + ended.ToString(inv)
            + ", \"stats_hr\": \"0x" + statsHr.ToString("x8") + "\", \"stats\": [" + Marshal.ReadInt32(stats, 4) + ", "
            + Marshal.ReadInt32(stats, 8) + ", " + Marshal.ReadInt32(stats, 20) + ", " + Marshal.ReadInt32(stats, 28) + "]"
            + ", \"priorities\": [" + string.Join(", ", priorities) + "]}");
        return 0;
    }

    // 0x43fa00: search directory, then the segment by class and file name; then 0x43f91e.
    static IntPtr Load(IntPtr loader, IntPtr perf, string dir, string file, uint repeats) {
        Guid all = AllTypes;
        Check(Slot<SetSearchDirectory>(loader, 5)(loader, ref all, dir, 0), "SetSearchDirectory");
        IntPtr od = Alloc(0x350);
        Marshal.WriteInt32(od, 0, 0x350);
        Marshal.WriteInt32(od, 4, 0x12);
        Marshal.Copy(CLSID_Segment.ToByteArray(), 0, od + 24, 16);
        char[] name = file.ToCharArray();
        Marshal.Copy(name, 0, od + 312, name.Length);
        Guid segIid = IID_Segment;
        IntPtr seg;
        Check(Slot<GetObject>(loader, 3)(loader, od, ref segIid, out seg), "Loader::GetObject " + file);
        Guid smf = StandardMIDIFile, dl = Download;
        Check(Slot<SetParam>(seg, 19)(seg, ref smf, 0xFFFFFFFF, 0, 0, perf), "SetParam(StandardMIDIFile)");
        Check(Slot<SetParam>(seg, 19)(seg, ref dl, 0xFFFFFFFF, 0, 0, perf), "SetParam(Download)");
        Check(Slot<Uint1>(seg, 6)(seg, repeats), "SetRepeats");
        return seg;
    }

    [UnmanagedFunctionPointer(Std)] delegate int GetFormatDelegate(IntPtr self, IntPtr wfx, ref uint wfxSize, out uint bufferSize);
}
