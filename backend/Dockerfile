FROM eclipse-temurin:17-jre
WORKDIR /app

ARG APP_JAR=backend/target/docker/fintech-api.jar
COPY ${APP_JAR} app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
