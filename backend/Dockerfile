FROM eclipse-temurin:17-jre
WORKDIR /app

COPY backend/target/fintech-api.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
