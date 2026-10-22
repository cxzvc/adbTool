package com.adbdesk.gps;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/** A single-purpose shell helper. It cannot grant/revoke permissions or accept another mask. */
public final class GpsIndicator {
    private static final String FINE = "android.permission.ACCESS_FINE_LOCATION";
    private static final String DEVICE = "default:0";
    private static final int MASK = 256;
    private static boolean attempted;
    private static boolean updateReturned;
    private static Snapshot before;
    private static Object packages, permissions;
    private static Class<?> packageApi, permissionApi;

    private static final class Refusal extends Exception {
        final String code;
        Refusal(String code, String message) { super(message); this.code = code; }
    }
    private static final class Snapshot {
        int uid, flags;
        boolean granted;
        String versionCode, sourceDir, firstInstallTimeMillis, lastUpdateTimeMillis;
        String[] peers;
        boolean requested;
    }
    private static Object call(Class<?> api, Object target, String name, Class<?>[] signature, Object... args) throws Exception {
        try { return api.getMethod(name, signature).invoke(target, args); }
        catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw error;
        }
    }
    private static Object service(String name, String apiName) throws Exception {
        Class<?> serviceManager = Class.forName("android.os.ServiceManager");
        Object binder = call(serviceManager, null, "getService", new Class<?>[]{String.class}, name);
        if (binder == null) throw new Refusal("gps_helper_service_unavailable", name + " service unavailable");
        Class<?> stub = Class.forName(apiName + "$Stub");
        return call(stub, null, "asInterface", new Class<?>[]{Class.forName("android.os.IBinder")}, binder);
    }
    private static void initialize() throws Exception {
        int uid = ((Number) call(Class.forName("android.os.Process"), null, "myUid", new Class<?>[0])).intValue();
        String context = String.valueOf(call(Class.forName("android.os.SELinux"), null, "getContext", new Class<?>[0])).trim();
        if (uid != 2000 || !(context.equals("u:r:shell:s0") || context.startsWith("u:r:shell:s0:")))
            throw new Refusal("gps_helper_shell_required", "ADB shell uid 2000 and shell SELinux context required");
        int currentUser = ((Number) call(Class.forName("android.app.ActivityManager"), null, "getCurrentUser", new Class<?>[0])).intValue();
        if (currentUser != 0) throw new Refusal("gps_helper_profile_unsupported", "Only the current primary user 0 is supported");
        packageApi = Class.forName("android.content.pm.IPackageManager");
        permissionApi = Class.forName("android.permission.IPermissionManager");
        packages = service("package", packageApi.getName());
        permissions = service("permissionmgr", permissionApi.getName());
        // Fail before mutation if this firmware has a different Binder API signature.
        permissionApi.getMethod("getPermissionFlags", String.class, String.class, String.class, int.class);
        permissionApi.getMethod("updatePermissionFlags", String.class, String.class, int.class, int.class, boolean.class, String.class, int.class);
        if (!checkPermission("android.permission.GRANT_RUNTIME_PERMISSIONS", "com.android.shell", 0)
                && !checkPermission("android.permission.REVOKE_RUNTIME_PERMISSIONS", "com.android.shell", 0))
            throw new Refusal("gps_helper_permission_denied", "GRANT_RUNTIME_PERMISSIONS or REVOKE_RUNTIME_PERMISSIONS required");
    }
    private static boolean checkPermission(String permission, String pkg, int user) throws Exception {
        return ((Number) call(packageApi, packages, "checkPermission", new Class<?>[]{String.class, String.class, int.class}, permission, pkg, user)).intValue() == 0;
    }
    private static Snapshot snapshot(String pkg, int user) throws Exception {
        Snapshot value = new Snapshot();
        value.uid = ((Number) call(packageApi, packages, "getPackageUid", new Class<?>[]{String.class, long.class, int.class}, pkg, 0L, user)).intValue();
        if (value.uid < 10000 || value.uid >= 100000)
            throw new Refusal("gps_helper_uid_unsupported", "Only an installed primary-user application UID is supported");
        value.peers = (String[]) call(packageApi, packages, "getPackagesForUid", new Class<?>[]{int.class}, value.uid);
        if (value.peers == null || value.peers.length != 1 || !pkg.equals(value.peers[0]))
            throw new Refusal("gps_helper_shared_uid", "Shared UID packages are not supported");
        Object info = call(packageApi, packages, "getPackageInfo", new Class<?>[]{String.class, long.class, int.class}, pkg, 4096L, user);
        if (info == null) throw new Refusal("gps_helper_package_missing", "Installed package not found");
        Class<?> infoClass = Class.forName("android.content.pm.PackageInfo");
        String[] requested = (String[]) infoClass.getField("requestedPermissions").get(info);
        value.requested = requested != null && Arrays.asList(requested).contains(FINE);
        value.versionCode = String.valueOf(((Number) call(infoClass, info, "getLongVersionCode", new Class<?>[0])).longValue());
        value.firstInstallTimeMillis = String.valueOf(infoClass.getField("firstInstallTime").getLong(info));
        value.lastUpdateTimeMillis = String.valueOf(infoClass.getField("lastUpdateTime").getLong(info));
        Object app = infoClass.getField("applicationInfo").get(info);
        if (app == null) throw new Refusal("gps_helper_package_missing", "Application identity unavailable");
        Class<?> appClass = Class.forName("android.content.pm.ApplicationInfo");
        if (appClass.getField("uid").getInt(app) != value.uid)
            throw new Refusal("gps_helper_identity_changed", "Package UID changed during query");
        value.sourceDir = (String) appClass.getField("sourceDir").get(app);
        if (value.sourceDir == null || !value.sourceDir.startsWith("/"))
            throw new Refusal("gps_helper_identity_unavailable", "Application source path unavailable");
        value.granted = checkPermission(FINE, pkg, user);
        value.flags = ((Number) call(permissionApi, permissions, "getPermissionFlags", new Class<?>[]{String.class, String.class, String.class, int.class}, pkg, FINE, DEVICE, user)).intValue();
        return value;
    }
    private static boolean pathMatches(String sourceDir, String expectedPath) {
        return sourceDir.equals(expectedPath) || expectedPath.equals(new File(sourceDir).getParent());
    }
    private static void ensureIdentity(Snapshot left, Snapshot right) throws Refusal {
        if (left.uid != right.uid || !left.versionCode.equals(right.versionCode) || !left.sourceDir.equals(right.sourceDir)
                || !left.firstInstallTimeMillis.equals(right.firstInstallTimeMillis) || !left.lastUpdateTimeMillis.equals(right.lastUpdateTimeMillis)
                || !Arrays.equals(left.peers, right.peers))
            throw new Refusal("gps_helper_identity_changed", "Package identity changed during operation");
    }
    private static int natural(String input, String label) throws Refusal {
        if (!input.matches("(?:0|[1-9][0-9]{0,9})")) throw new Refusal("gps_helper_invalid", "Invalid " + label);
        try { return Integer.parseInt(input); }
        catch (NumberFormatException error) { throw new Refusal("gps_helper_invalid", "Invalid " + label); }
    }
    private static Map<String,Object> run(String[] args) throws Exception {
        if (args.length != 9 || !args[0].equals("change") || !args[1].matches("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*") || args[1].length() > 255)
            throw new Refusal("gps_helper_invalid", "Fixed change arguments required");
        String pkg = args[1];
        int user = natural(args[2], "user"), expectedUid = natural(args[3], "uid"), expectedFlags = natural(args[4], "flags"), target = natural(args[8], "value");
        if (user != 0 || !(args[5].equals("true") || args[5].equals("false")) || !(target == 0 || target == MASK)
                || !args[6].matches("(?:0|[1-9][0-9]{0,18})") || !args[7].startsWith("/") || args[7].length() > 2048
                || args[7].matches("(?s).*[\\x00-\\x1f\\x7f].*"))
            throw new Refusal("gps_helper_invalid", "Unsupported user, grant, identity or bit value");
        initialize();
        before = snapshot(pkg, user);
        if (!before.requested)
            throw new Refusal("gps_helper_location_not_requested", "Package must request precise location; the helper cannot add permissions");
        if (before.uid != expectedUid || before.flags != expectedFlags || before.granted != Boolean.parseBoolean(args[5]) || !before.versionCode.equals(args[6]) || !pathMatches(before.sourceDir, args[7]))
            throw new Refusal("gps_helper_stale", "Permission flags or app identity changed; query again");
        Snapshot after = before;
        if ((before.flags & MASK) != target) {
            attempted = true;
            call(permissionApi, permissions, "updatePermissionFlags", new Class<?>[]{String.class, String.class, int.class, int.class, boolean.class, String.class, int.class}, pkg, FINE, MASK, target, true, DEVICE, user);
            updateReturned = true;
            after = snapshot(pkg, user);
            ensureIdentity(before, after);
            if (after.granted != before.granted || (after.flags & ~MASK) != (before.flags & ~MASK) || (after.flags & MASK) != target)
                throw new Refusal("gps_helper_verify_failed", "Result differs from the fixed permission bit operation; no automatic grant or full-flags restoration was attempted");
        }
        Map<String,Object> result = result(after, args[7]);
        result.put("ok", true);
        result.put("attempted", attempted);
        result.put("changed", before.flags != after.flags);
        result.put("verified", true);
        result.put("beforeFlags", before.flags);
        result.put("beforeGranted", before.granted);
        result.put("mayHaveChanged", false);
        return result;
    }
    private static Map<String,Object> result(Snapshot value, String codePath) {
        Map<String,Object> result = new LinkedHashMap<String,Object>();
        result.put("uid", value.uid);
        result.put("flags", value.flags);
        result.put("granted", value.granted);
        result.put("versionCode", value.versionCode);
        result.put("codePath", codePath);
        result.put("sourceDir", value.sourceDir);
        result.put("firstInstallTimeMillis", value.firstInstallTimeMillis);
        result.put("lastUpdateTimeMillis", value.lastUpdateTimeMillis);
        result.put("peers", value.peers);
        return result;
    }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map) {
            StringBuilder out = new StringBuilder("{"); boolean comma = false;
            for (Object rawEntry : ((Map<?,?>)value).entrySet()) {
                Map.Entry<?,?> entry = (Map.Entry<?,?>)rawEntry;
                if (comma) out.append(','); comma = true;
                out.append(json(entry.getKey().toString())).append(':').append(json(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof String[]) {
            StringBuilder out = new StringBuilder("["); boolean comma = false;
            for (String item : (String[])value) { if (comma) out.append(','); comma = true; out.append(json(item)); }
            return out.append(']').toString();
        }
        StringBuilder out = new StringBuilder("\"");
        for (char character : value.toString().toCharArray()) {
            if (character == '"' || character == '\\') out.append('\\').append(character);
            else if (character < 32) out.append(String.format("\\u%04x", (int)character));
            else out.append(character);
        }
        return out.append('"').toString();
    }
    public static void main(String[] args) {
        Map<String,Object> result;
        try { result = run(args); }
        catch (Throwable error) {
            result = new LinkedHashMap<String,Object>();
            result.put("ok", false);
            result.put("code", error instanceof Refusal ? ((Refusal)error).code : error instanceof SecurityException ? updateReturned ? "gps_helper_readback_denied" : "gps_helper_permission_denied" : "gps_helper_failed");
            result.put("message", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
            result.put("attempted", attempted);
            result.put("changed", false);
            result.put("verified", false);
            // A setter SecurityException is a refusal; a denied verification read
            // after the setter returned cannot establish that nothing changed.
            result.put("mayHaveChanged", attempted && (updateReturned || !(error instanceof SecurityException)));
            if (before != null) { result.put("beforeFlags", before.flags); result.put("beforeGranted", before.granted); }
        }
        System.out.println("ADB_DESK_GPS_RESULT=" + json(result));
    }
}
