public class HealthCheck {
    public static void main(String[] args) throws Exception {
        var url = new java.net.URL("http://localhost:8080/fhir/metadata");
        var conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(10000);
        conn.setRequestMethod("GET");
        int code = conn.getResponseCode();
        System.exit(code == 200 ? 0 : 1);
    }
}
