// Compatibility header for building with MinGW (which lacks MSVC's __try/__except)
#ifndef _HVNC_SEH_COMPAT_H
#define _HVNC_SEH_COMPAT_H

#ifdef __MINGW32__
#if defined(NDEBUG)
// Catch accidental production use of MinGW builds: without real SEH every hardware
// exception inside a hook function will crash the host process uncaught.
#error "MinGW SEH stubs must not be used in Release/production (NDEBUG) builds. Use MSVC (v143) for all production targets."
#endif

// MinGW does not implement MSVC Structured Exception Handling (__try/__except).
// These macros replace every __try/__except block with unguarded straight-line
// code: the __try body executes unconditionally, and the __except body is
// compiled away (the condition "if (0)" is never true).
//
// PRODUCTION SAFETY WARNING:
//   Any access violation, illegal instruction, or other hardware exception that
//   occurs inside a hook function on a MinGW build will propagate UNCAUGHT into
//   the host process and crash it.  On MSVC builds the same exception is caught
//   by the __except handler, logged to the crash log, and the host process
//   continues running.
//
//   MinGW builds are therefore NOT safe for production use on any Windows
//   locale.  Use MSVC (Visual Studio 2022 / v143 toolset) for production
//   builds.  The MinGW path exists only for build-system compatibility during
//   development.
#define __try
#define __except(x) if (0)
#define __finally

// MSVC provides GetExceptionCode() as an intrinsic inside __except filters.
// Provide a stub that always returns 0 so that the (dead) exception-handler
// body compiles without error under MinGW.
#ifndef GetExceptionCode
#define GetExceptionCode() 0
#endif
#endif // __MINGW32__

#endif // _HVNC_SEH_COMPAT_H
