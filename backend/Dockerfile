FROM eclipse-temurin:17-jre
WORKDIR /app

COPY backend/target/docker/fintech-api.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
