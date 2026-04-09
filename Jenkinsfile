pipeline {
    agent any

    environment {
        DEPLOY_DIR = "D:\\deploy\\smartbusai"
        NODE_ENV   = "production"
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Pulling code from GitHub...'
                checkout scm
            }
        }

        stage('Validate') {
            steps {
                echo 'Checking Node.js and npm...'
                bat 'node --version'
                bat 'npm --version'
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing dependencies...'
                bat 'npm ci --omit=dev'
            }
        }

        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                echo 'Deploying to local server...'
                bat """
                    if not exist "${DEPLOY_DIR}" mkdir "${DEPLOY_DIR}"
                    xcopy /E /Y /I . "${DEPLOY_DIR}" /EXCLUDE:.jenkinscopyexclude
                    cd /d "${DEPLOY_DIR}"
                    npm ci --omit=dev
                """
                echo 'Restarting app with PM2...'
                bat """
                    cd /d "${DEPLOY_DIR}"
                    pm2 restart smartbusai || pm2 start server/server.js --name smartbusai
                    pm2 save
                """
            }
        }

        stage('Health Check') {
            when {
                branch 'main'
            }
            steps {
                echo 'Checking app health...'
                bat '''
                    timeout /t 15 /nobreak
                    curl -f http://localhost:2704/api/auth/test || exit 1
                    echo App is healthy!
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline SUCCESS — SmartBusAI deployed!'
        }
        failure {
            echo 'Pipeline FAILED — Check logs above'
        }
    }
}
